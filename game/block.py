"""
Module pour la gestion des blocs dans le jeu Minecraft Clone.
"""
from enum import Enum
from ursina import *


class BlockType(Enum):
    """Types de blocs disponibles dans le jeu."""
    AIR = 0
    GRASS = 1
    DIRT = 2
    STONE = 3
    WOOD = 4
    LEAF = 5
    SAND = 6
    WATER = 7
    LAVA = 8
    SNOW = 9
    BEDROCK = 10


# Couleurs des blocs (RGB)
BLOCK_COLORS = {
    BlockType.AIR: (0, 0, 0, 0),  # Transparent
    BlockType.GRASS: (0, 128, 0, 255),  # Vert
    BlockType.DIRT: (139, 69, 19, 255),  # Marron
    BlockType.STONE: (128, 128, 128, 255),  # Gris
    BlockType.WOOD: (101, 67, 33, 255),  # Marron clair
    BlockType.LEAF: (34, 139, 34, 255),  # Vert clair
    BlockType.SAND: (245, 222, 179, 255),  # Beige
    BlockType.WATER: (0, 0, 255, 150),  # Bleu transparent
    BlockType.LAVA: (255, 69, 0, 200),  # Orange transparent
    BlockType.SNOW: (255, 255, 255, 255),  # Blanc
    BlockType.BEDROCK: (50, 50, 50, 255),  # Gris foncé
}


class Block(Button):
    """
    Classe représentant un bloc dans le monde 3D.
    Hérite de Button pour permettre les interactions (clic).
    """
    def __init__(self, position=(0, 0, 0), block_type=BlockType.DIRT, **kwargs):
        super().__init__(
            parent=scene,
            position=position,
            model='cube',
            origin_y=0.5,
            texture=None,
            color=BLOCK_COLORS[block_type],
            scale=1,
            **kwargs
        )
        self.block_type = block_type
        self.position = Vec3(*position)
        
    def input(self, key):
        """Gère les entrées utilisateur pour détruire un bloc."""
        if self.hovered:
            if key == 'left mouse down':
                # Détruit le bloc
                destroy(self)
                return True
        return False


class BlockPicker:
    """Gère la sélection des blocs pour la construction."""
    def __init__(self):
        self.current_block_type = BlockType.DIRT
        self.block_types = list(BlockType)
        self.current_index = self.block_types.index(self.current_block_type)
        
    def next_block(self):
        """Passe au type de bloc suivant."""
        self.current_index = (self.current_index + 1) % len(self.block_types)
        self.current_block_type = self.block_types[self.current_index]
        return self.current_block_type
        
    def prev_block(self):
        """Passe au type de bloc précédent."""
        self.current_index = (self.current_index - 1) % len(self.block_types)
        self.current_block_type = self.block_types[self.current_index]
        return self.current_block_type
