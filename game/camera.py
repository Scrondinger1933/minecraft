"""
Module pour la gestion de la caméra dans le jeu Minecraft Clone.
"""
from ursina import *


class Camera(Entity):
    """
    Classe représentant la caméra du joueur.
    Gère la rotation et le point de vue.
    """
    def __init__(self, **kwargs):
        super().__init__(
            parent=camera,
            position=(0, 0, 0),
            rotation=(0, 0, 0),
            **kwargs
        )
        
        # Sensibilité de la souris
        self.mouse_sensitivity = 0.1
        
        # Verrouille le curseur de la souris
        mouse.locked = True
        
    def update(self):
        """Mets à jour la caméra à chaque frame."""
        # Rotation de la caméra avec la souris
        self.rotation_x += mouse.dy * self.mouse_sensitivity
        self.rotation_y += mouse.dx * self.mouse_sensitivity
        
        # Limite la rotation verticale pour éviter de voir à travers le sol
        self.rotation_x = clamp(self.rotation_x, -90, 90)
        
        # Réinitialise la position de la souris
        mouse.dx = 0
        mouse.dy = 0
