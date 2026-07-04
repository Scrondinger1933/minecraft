"""
Module pour la génération et la gestion du monde dans le jeu Minecraft Clone.
"""
import random
import noise
from ursina import *
from .block import Block, BlockType


class World:
    """
    Classe représentant le monde du jeu.
    Gère la génération procédurale et le stockage des blocs.
    """
    def __init__(self, size=32, height=16):
        self.size = size  # Taille du monde (carré)
        self.height = height  # Hauteur maximale
        self.blocks = {}  # Dictionnaire pour stocker les blocs: {(x, y, z): BlockType}
        self.chunk_size = 16  # Taille des chunks pour l'optimisation
        self.loaded_chunks = set()  # Chunks actuellement chargés
        
        # Génère le monde initial
        self.generate_world()
        
    def generate_world(self):
        """Génère le monde avec du bruit de Perlin pour les terrains."""
        # Génère le terrain de base
        for x in range(-self.size//2, self.size//2):
            for z in range(-self.size//2, self.size//2):
                # Utilise du bruit de Perlin pour la hauteur
                terrain_height = self._get_terrain_height(x, z)
                
                # Génère les couches de blocs
                for y in range(terrain_height):
                    if y == terrain_height - 1:
                        block_type = BlockType.GRASS
                    elif y >= terrain_height - 4:
                        block_type = BlockType.DIRT
                    else:
                        block_type = BlockType.STONE
                    
                    self.blocks[(x, y, z)] = block_type
                    
                # Ajoute du bedrock au fond
                self.blocks[(x, 0, z)] = BlockType.BEDROCK
        
        # Ajoute des arbres aléatoires
        self._generate_trees()
        
    def _get_terrain_height(self, x, z):
        """Calcule la hauteur du terrain à une position donnée."""
        # Utilise du bruit de Perlin pour un terrain naturel
        scale = 0.1
        octaves = 6
        persistence = 0.5
        lacunarity = 2.0
        
        # Génère le bruit
        value = noise.pnoise2(
            x * scale,
            z * scale,
            octaves=octaves,
            persistence=persistence,
            lacunarity=lacunarity,
            repeatx=1024,
            repeaty=1024,
            base=0
        )
        
        # Mappe le bruit à une hauteur (entre 5 et 15)
        height = int((value + 1) * 0.5 * (self.height - 5) + 5)
        return max(1, min(height, self.height - 1))
        
    def _generate_trees(self):
        """Génère des arbres aléatoires dans le monde."""
        num_trees = 20
        for _ in range(num_trees):
            x = random.randint(-self.size//2 + 2, self.size//2 - 2)
            z = random.randint(-self.size//2 + 2, self.size//2 - 2)
            
            # Trouve la hauteur du terrain à cette position
            terrain_height = 0
            for y in range(self.height):
                if (x, y, z) in self.blocks:
                    terrain_height = y
                else:
                    break
            
            # Ajoute le tronc de l'arbre
            tree_height = random.randint(3, 5)
            for y in range(terrain_height + 1, terrain_height + tree_height + 1):
                self.blocks[(x, y, z)] = BlockType.WOOD
                
            # Ajoute les feuilles
            for dx in range(-1, 2):
                for dz in range(-1, 2):
                    for dy in range(-1, 2):
                        leaf_x = x + dx
                        leaf_y = terrain_height + tree_height + dy
                        leaf_z = z + dz
                        if (leaf_x, leaf_y, leaf_z) not in self.blocks:
                            self.blocks[(leaf_x, leaf_y, leaf_z)] = BlockType.LEAF
                            
    def get_block(self, x, y, z):
        """Récupère le type de bloc à une position donnée."""
        return self.blocks.get((int(x), int(y), int(z)), BlockType.AIR)
        
    def set_block(self, x, y, z, block_type):
        """Place un bloc à une position donnée."""
        x, y, z = int(x), int(y), int(z)
        if block_type == BlockType.AIR:
            if (x, y, z) in self.blocks:
                del self.blocks[(x, y, z)]
        else:
            self.blocks[(x, y, z)] = block_type
            
    def render_chunk(self, chunk_x, chunk_z):
        """Rend un chunk du monde."""
        chunk_key = (chunk_x, chunk_z)
        if chunk_key in self.loaded_chunks:
            return
            
        self.loaded_chunks.add(chunk_key)
        
        # Calcule les limites du chunk
        start_x = chunk_x * self.chunk_size
        start_z = chunk_z * self.chunk_size
        end_x = start_x + self.chunk_size
        end_z = start_z + self.chunk_size
        
        # Rend tous les blocs dans le chunk
        for x in range(start_x, end_x):
            for z in range(start_z, end_z):
                for y in range(self.height):
                    block_type = self.get_block(x, y, z)
                    if block_type != BlockType.AIR:
                        Block(position=(x, y, z), block_type=block_type)
                        
    def unload_chunk(self, chunk_x, chunk_z):
        """Décharge un chunk du monde."""
        chunk_key = (chunk_x, chunk_z)
        if chunk_key not in self.loaded_chunks:
            return
            
        self.loaded_chunks.remove(chunk_key)
        
        # Calcule les limites du chunk
        start_x = chunk_x * self.chunk_size
        start_z = chunk_z * self.chunk_size
        end_x = start_x + self.chunk_size
        end_z = start_z + self.chunk_size
        
        # Détruit tous les blocs dans le chunk
        for x in range(start_x, end_x):
            for z in range(start_z, end_z):
                for y in range(self.height):
                    block_type = self.get_block(x, y, z)
                    if block_type != BlockType.AIR:
                        # Trouve et détruit l'entité Ursina correspondante
                        for entity in scene.entities:
                            if isinstance(entity, Block) and entity.position == Vec3(x, y, z):
                                destroy(entity)
                                
    def render_around_player(self, player_x, player_z, render_distance=2):
        """Rend les chunks autour du joueur."""
        player_chunk_x = int(player_x // self.chunk_size)
        player_chunk_z = int(player_z // self.chunk_size)
        
        # Décharge les chunks trop éloignés
        for chunk in list(self.loaded_chunks):
            chunk_x, chunk_z = chunk
            if (abs(chunk_x - player_chunk_x) > render_distance or 
                abs(chunk_z - player_chunk_z) > render_distance):
                self.unload_chunk(chunk_x, chunk_z)
                
        # Charge les chunks autour du joueur
        for dx in range(-render_distance, render_distance + 1):
            for dz in range(-render_distance, render_distance + 1):
                chunk_x = player_chunk_x + dx
                chunk_z = player_chunk_z + dz
                self.render_chunk(chunk_x, chunk_z)
