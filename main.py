#!/usr/bin/env python3
"""
Minecraft Clone 3D - Point d'entrée principal du jeu.

Ce jeu est un clone simplifié de Minecraft en 3D utilisant Ursina Engine.
Contrôles :
- WASD : Déplacement
- Espace : Saut
- Shift : Descendre (mode créatif)
- Souris : Regarder autour
- Clic gauche : Détruire un bloc
- Clic droit : Placer un bloc
- 1 : Changer de bloc (suivant)
- 2 : Changer de bloc (précédent)
- Échap : Quitter le jeu
"""

from ursina import *
from game.world import World
from game.player import Player
from game.block import Block, BlockType


def main():
    # Initialise le moteur Ursina
    app = Ursina(
        title="Minecraft Clone 3D",
        fullscreen=False,
        vsync=True,
        borderless=False,
        resolution=(1280, 720),
        development_mode=False
    )
    
    # Crée le monde
    world = World(size=64, height=32)
    
    # Crée le joueur
    player = Player()
    
    # Charge les chunks autour du joueur
    world.render_around_player(player.x, player.z, render_distance=2)
    
    # Crée le ciel (arrière-plan)
    sky = Sky(
        texture='assets/textures/sky.png',
        color=color.sky,
        scale=1000,
        double_sided=True
    )
    
    # Ajoute un sol infini (optionnel)
    ground = Entity(
        model='plane',
        color=color.green,
        scale=(1000, 1, 1000),
        position=(0, -1, 0),
        collider='box'
    )
    
    # Interface utilisateur
    ui = Entity(parent=camera.ui, enabled=True)
    
    # Texte d'aide
    help_text = Text(
        parent=ui,
        text="Contrôles:\nWASD: Déplacement\nEspace: Saut\nShift: Descendre\nClic gauche: Détruire\nClic droit: Placer\n1/2: Changer de bloc\nÉchap: Quitter",
        position=(-0.45, 0.4),
        scale=0.5,
        color=color.white,
        background=True
    )
    
    # Gère les entrées utilisateur
    def input(key):
        if key == 'escape':
            # Quitte le jeu
            app.quit()
            
        if key == 'tab':
            # Affiche/masque l'aide
            help_text.enabled = not help_text.enabled
            
    # Boucle principale du jeu
    def update():
        # Mets à jour le joueur
        player.update()
        
        # Mets à jour le monde autour du joueur
        world.render_around_player(player.x, player.z, render_distance=2)
        
    # Démarre le jeu
    app.run()


if __name__ == "__main__":
    main()
