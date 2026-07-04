"""
Module pour la gestion du joueur dans le jeu Minecraft Clone.
"""
from ursina import *
from .block import Block, BlockType, BlockPicker


class Player(Entity):
    """
    Classe représentant le joueur dans le monde 3D.
    Gère les mouvements, les contrôles et les interactions.
    """
    def __init__(self, **kwargs):
        super().__init__(
            parent=scene,
            model='cube',
            color=color.blue,
            scale=(0.8, 1.8, 0.8),
            collider='box',
            **kwargs
        )
        
        # Propriétés du joueur
        self.speed = 5  # Vitesse de déplacement
        self.jump_force = 0.5  # Force de saut
        self.gravity = 0.5  # Gravité
        self.velocity_y = 0  # Vitesse verticale
        self.is_grounded = False  # Est-ce que le joueur est au sol ?
        
        # Sélecteur de blocs
        self.block_picker = BlockPicker()
        self.current_block_type = self.block_picker.current_block_type
        
        # Position initiale
        self.position = Vec3(0, 20, 0)
        
        # Caméra
        self.camera = Camera(parent=self, position=(0, 1.8, 0), rotation=(0, 0, 0))
        
        # Réticule pour la construction
        self.reticle = Entity(
            parent=camera.ui,
            model='quad',
            color=color.white,
            scale=(0.02, 0.02),
            position=(0, 0, -1)
        )
        
        # Indicateur de bloc sélectionné
        self.block_indicator = Entity(
            parent=camera.ui,
            model='quad',
            color=BLOCK_COLORS[self.current_block_type],
            scale=(0.1, 0.1),
            position=(-0.4, -0.4, -1)
        )
        
    def update(self):
        """Mets à jour le joueur à chaque frame."""
        # Applique la gravité
        if not self.is_grounded:
            self.velocity_y -= self.gravity * time.dt
            self.y += self.velocity_y * time.dt
            
        # Vérifie si le joueur est au sol
        self.is_grounded = False
        ray = raycast(self.position, (0, -1, 0), distance=1.1, ignore=[self])
        if ray.hit:
            self.is_grounded = True
            if self.velocity_y < 0:
                self.velocity_y = 0
                self.y = ray.world_point.y + 1.1
                
        # Gère les mouvements
        self._handle_movement()
        
        # Gère la sélection de blocs
        self._handle_block_selection()
        
        # Gère la construction/destruction de blocs
        self._handle_block_interactions()
        
    def _handle_movement(self):
        """Gère les mouvements du joueur."""
        # Déplacement horizontal
        move_direction = Vec3(0, 0, 0)
        
        if held_keys['w']:
            move_direction += self.forward
        if held_keys['s']:
            move_direction -= self.forward
        if held_keys['a']:
            move_direction -= self.right
        if held_keys['d']:
            move_direction += self.right
            
        # Normalise la direction
        if move_direction.length() > 0:
            move_direction = move_direction.normalized()
            
        # Applique le mouvement
        self.x += move_direction.x * self.speed * time.dt
        self.z += move_direction.z * self.speed * time.dt
        
        # Saut
        if self.is_grounded and held_keys['space']:
            self.velocity_y = self.jump_force
            self.is_grounded = False
            
        # Vol (pour le mode créatif)
        if held_keys['shift']:
            self.y -= self.speed * time.dt
        if held_keys['space'] and not self.is_grounded:
            self.y += self.speed * time.dt
            
    def _handle_block_selection(self):
        """Gère la sélection du type de bloc."""
        if held_keys['1']:
            self.current_block_type = self.block_picker.next_block()
            self.block_indicator.color = BLOCK_COLORS[self.current_block_type]
            time.sleep(0.2)  # Évite de changer trop vite
            
        if held_keys['2']:
            self.current_block_type = self.block_picker.prev_block()
            self.block_indicator.color = BLOCK_COLORS[self.current_block_type]
            time.sleep(0.2)
            
    def _handle_block_interactions(self):
        """Gère la construction et la destruction de blocs."""
        # Destruction de blocs (clic gauche)
        if mouse.left:
            # Lance un rayon depuis la caméra
            ray = raycast(
                camera.world_position,
                camera.forward,
                distance=10,
                ignore=[self, self.camera]
            )
            if ray.hit:
                hit_entity = ray.entity
                if isinstance(hit_entity, Block):
                    destroy(hit_entity)
                    
        # Construction de blocs (clic droit)
        if mouse.right:
            # Lance un rayon depuis la caméra
            ray = raycast(
                camera.world_position,
                camera.forward,
                distance=10,
                ignore=[self, self.camera]
            )
            if ray.hit:
                hit_entity = ray.entity
                hit_position = ray.world_point
                
                # Calcule la position du nouveau bloc
                if isinstance(hit_entity, Block):
                    # Trouve la face cliquée
                    normal = ray.normal
                    new_position = hit_position + normal
                    
                    # Arrondit à la position de la grille
                    new_position = Vec3(
                        round(new_position.x),
                        round(new_position.y),
                        round(new_position.z)
                    )
                    
                    # Crée le nouveau bloc
                    Block(position=new_position, block_type=self.current_block_type)
