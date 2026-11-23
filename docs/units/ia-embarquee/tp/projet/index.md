# Projet : Drone de surveillance des accidents sur autoroute (FRDM-MCXN947)


## Présentation

Ce projet est **évalué**. Il ne donne pas toutes les étapes : il fixe **ce que le système doit faire** (le cahier des charges) et donne des **indications**. À vous de concevoir l'architecture, d'écrire le code, de le tester et de justifier vos choix.

**Le scénario.** Des petits drones survolent une autoroute pour repérer les accidents. Chaque drone suit une trajectoire, prend des photos et les analyse **à bord**, avec un réseau de neurones exécuté sur le NPU : pas de liaison vidéo vers le sol, seulement des messages courts. Quand un drone voit un accident, il allume son voyant rouge et **prévient les drones voisins** en leur envoyant **sa position**. Sinon, son voyant reste vert.

**Dans ce projet, le drone est la carte FRDM-MCXN947.** Comme on n'a ni drone, ni caméra, ni radio, on les **simule** :

| Élément réel | Simulation sur la carte |
| --- | --- |
| Moteurs et GPS | Une tâche qui calcule la position du drone le long de l'autoroute, une droite `y = x`, à vitesse constante |
| Caméra | Des images stockées dans la Flash. Un appui sur **SW2** = le drone prend une nouvelle photo |
| Réseau de neurones | Un classifieur `accident` / `pas_accident` que vous entraînez (voir la partie 7), exécuté sur le NPU Neutron |
| Voyant d'alerte | La LED RGB de la carte : **rouge** si accident, **verte** sinon |
| Radio vers les drones voisins | Des messages affichés dans le **terminal série** (115200 8N1) |

**Organisation**

| | |
| --- | --- |
| Travail | En binôme |
| Durée | **Une séance de 4 h** |
| Matériel | Une FRDM-MCXN947 par binôme, câble USB-C sur **MCU-Link (J17)** |
| Logiciel | MCUXpresso IDE et SDK FRDM-MCXN947 **2.14.0** avec eIQ, eIQ Toolkit 1.17 (eIQ Portal, convertisseur Neutron réglé sur **MCUXpresso SDK 2.14.0**), Python 3 avec `pip install opencv-python numpy` |
| Point de départ | Le projet d'exemple `tflm_label_image` du SDK (**Import SDK example(s)** → `eiq_examples` → `tflm_label_image`) |
| À rendre en fin de séance | Le code, un compte rendu court, une démonstration (partie 6) |

**Déroulé conseillé**

Commencez par le réseau de neurones (partie 7) : une fois le modèle sur la carte, tout le reste du projet se teste avec lui.

| Temps | Travail |
| --- | --- |
| 0 h 00 – 1 h 00 | Lire le sujet. Préparer le jeu de données, entraîner, exporter, convertir et intégrer le modèle dans `tflm_label_image` ; vérifier sur la carte (partie 7) |
| 1 h 00 – 2 h 00 | Tâches Trajet et Bouton (parties 3 et 4) |
| 2 h 00 – 3 h 15 | Images dans la Flash (4.5), tâches Détection, Alerte, Communication ; tests de la partie 5 |
| 3 h 15 – 4 h 00 | Compte rendu, démonstration, bonus éventuels |

## Partie 1 — Cahier des charges fonctionnel

Chaque exigence a un identifiant (`F1`, `F2`…). Utilisez ces identifiants dans votre compte rendu et dans votre tableau de tests (partie 5).

**F1 — Identité du drone**

- Chaque drone a un **numéro** `ID_DRONE` (de 1 à 99), défini par une constante dans le code. Chaque binôme prend le numéro donné par l'enseignant.
- Au démarrage, le drone affiche une ligne de présentation : son numéro, sa vitesse, sa position de départ, le seuil d'alerte.

**F2 — Trajectoire**

- L'autoroute est la droite **`y = x`**. Le drone part du point `(0, 0)` et la survole à la vitesse `VITESSE_DRONE`, en mètres par seconde (valeur par défaut : **25 m/s**, soit 90 km/h).
- La position `(x, y)` est mise à jour **toutes les 100 ms**. Les distances sont en mètres, avec une précision d'au moins 1 cm.
- Le tronçon surveillé va de `x = 0` à `x = 1000 m`. Au bout du tronçon, le drone **fait demi-tour** et revient vers `(0, 0)`, puis repart, et ainsi de suite (aller-retour).
- Toutes les **secondes**, le drone affiche sa position et le temps écoulé depuis le démarrage.

**F3 — Prise de photo**

- Chaque appui sur **SW2** correspond à une photo prise **à la position actuelle** du drone.
- Les photos défilent dans l'ordre des images stockées ; après la dernière, on revient à la première.
- Un appui doit compter pour **une seule** photo (gérer les rebonds du bouton).
- **Le drone ne s'arrête pas d'avancer** pendant qu'il attend un appui : la position continue à être mise à jour toutes les 100 ms. C'est l'exigence la plus importante du projet (voir la partie 3).

**F4 — Détection**

- Chaque photo est analysée par votre modèle `accident` / `pas_accident`, sur le NPU.
- Le drone calcule le **score accident** (en %) et le compare au seuil `SEUIL_ALERTE_ACCIDENT`.
- Il affiche : le nom de l'image, la position de la photo, la classe trouvée, le score accident et le temps d'inférence.

**F5 — Alerte locale (LED)**

- Accident détecté : LED **rouge** allumée, LED verte éteinte.
- Pas d'accident : LED **verte** allumée, LED rouge éteinte.
- La LED garde son état jusqu'à la photo suivante.

**F6 — Communication avec les drones voisins**

- En cas d'accident, le drone **envoie un message d'alerte** à ses voisins, avec **sa position au moment de la photo**. La radio est simulée : le message est affiché dans le terminal, sur une ligne qui commence par `[RADIO]`.
- Le message suit **exactement** le format de la partie 2, pour qu'un autre programme puisse le lire.
- Le drone envoie aussi un message d'état `RAS` (rien à signaler) après chaque photo sans accident.

**F7 — Bilan**

- Le drone compte les photos analysées et les alertes envoyées. Ces deux compteurs apparaissent dans chaque message d'état (partie 2).

**Ce que vous pouvez choisir.** Tout ce qui n'est pas écrit ci-dessus est libre : noms des fonctions, découpage des fichiers, textes affichés (sauf les messages `[RADIO]`), méthode de calcul de la trajectoire, façon de lire le bouton. Chaque choix important doit être **justifié dans le compte rendu**.

## Partie 2 — Format des messages radio

Les messages vers les drones voisins tiennent sur **une ligne**, commencent par `[RADIO] $`, et les champs sont séparés par des virgules (comme les trames NMEA des GPS). Les nombres sont des **entiers**.

**Message d'alerte (F6)**

```
[RADIO] $ACCIDENT,<id>,<t_ms>,<x_cm>,<y_cm>,<score>,<image>
```

**Message d'état après une photo sans accident (F6, F7)**

```
[RADIO] $RAS,<id>,<t_ms>,<x_cm>,<y_cm>,<nb_photos>,<nb_alertes>
```

| Champ | Signification | Exemple |
| --- | --- | --- |
| `id` | Numéro du drone (`ID_DRONE`) | `7` |
| `t_ms` | Temps depuis le démarrage, en millisecondes, **au moment de la photo** | `12400` |
| `x_cm`, `y_cm` | Position du drone **au moment de la photo**, en centimètres | `21920`, `21920` |
| `score` | Score accident en % | `97` |
| `image` | Nom de l'image analysée | `accident_1` |
| `nb_photos`, `nb_alertes` | Compteurs de F7 | `2`, `1` |

**Exemple de terminal attendu** (les valeurs sont données à titre d'exemple ; les lignes autres que `[RADIO]` sont libres) :

```
Drone 7 : depart (0.00 m, 0.00 m), vitesse 25 m/s, seuil accident 50 %
[t=1.0 s] position (17.67 m, 17.67 m)
[t=2.0 s] position (35.35 m, 35.35 m)
...
Photo 1 (accident_1) a (219.20 m, 219.20 m) : accident, score accident 97 %, 16 ms
[RADIO] $ACCIDENT,7,12400,21920,21920,97,accident_1
[t=13.0 s] position (229.80 m, 229.80 m)
...
Photo 2 (pas_accident_1) a (282.84 m, 282.84 m) : pas_accident, score accident 4 %, 16 ms
[RADIO] $RAS,7,16000,28284,28284,2,1
```

## Partie 3 — Architecture logicielle

L'exemple `tflm_label_image` est construit autour d'une **boucle** dans `main()` (fichier `source/main.cpp`) :

```
while (1)
    IMAGE_GetImage()       <- copie l'image dans l'entree du modele
    MODEL_ConvertInput()
    MODEL_RunInference()   <- quelques dizaines de ms sur le NPU
    MODEL_ProcessOutput()  <- affiche "Detected: ..."
```

Dans l'exemple d'origine, `IMAGE_GetImage` (fichier `source/image/image_load.c`) fournit une seule image, puis bloque la carte. La solution « évidente » pour passer d'une image à l'autre, attendre l'appui dans une boucle `while`, bloque aussi tout le reste : un drone qui s'arrête en l'air chaque fois qu'il attend une photo, ce n'est pas acceptable (exigence **F3**). Il faut donc **organiser le programme en tâches**.

**3.1 Les tâches à réaliser**

Votre programme doit contenir au moins les tâches suivantes. Une « tâche » est une fonction qui a un rôle précis et qui ne bloque jamais les autres.

| Tâche | Rôle | Déclenchement | Exigences |
| --- | --- | --- | --- |
| **Trajet** | Mettre à jour `(x, y)` et gérer le demi-tour ; afficher la position chaque seconde | Périodique, toutes les 100 ms | F2 |
| **Bouton** | Détecter un **nouvel** appui sur SW2, sans attendre | Périodique (par exemple toutes les 10 ms) ou interruption | F3 |
| **Détection** | Charger l'image suivante, noter la position et l'heure de la photo, lancer l'inférence, calculer le score accident | Sur un appui (événement venant de la tâche Bouton) | F3, F4 |
| **Alerte** | Allumer la bonne LED | Sur un résultat de la tâche Détection | F5 |
| **Communication** | Construire et afficher le message `[RADIO]` | Sur un résultat de la tâche Détection | F6, F7 |

**3.2 Ce que les tâches s'échangent**

```
                  position (x, y)
   [Trajet] ----------------------------+
                                        v
   [Bouton] --- « nouvelle photo » ---> [Detection] --- resultat ---> [Alerte]      (LED)
                                                     \
                                                      +-- resultat ---> [Communication]  ([RADIO])
```

Le **résultat** d'une détection regroupe au moins : la classe, le score accident, le nom de l'image, la position et l'heure de la photo. Rangez-le dans une **structure** C (`struct`).

**3.3 Architecture imposée : super-boucle non bloquante**

La boucle de `main()` appelle les tâches les unes après les autres, sans fin. Chaque tâche regarde **l'heure** : si ce n'est pas son moment, elle rend la main tout de suite ; si c'est son moment, elle fait son travail **rapidement** et rend la main.

```c
while (1)
{
    Tache_Trajet();          /* fait quelque chose seulement toutes les 100 ms */
    Tache_Bouton();          /* toutes les 10 ms : un nouvel appui ? */
    Tache_Detection();       /* seulement si un appui a ete vu */
    Tache_Alerte();          /* seulement si un nouveau resultat existe */
    Tache_Communication();   /* idem */
}
```

**Règle d'or : aucune boucle d'attente** (`while (bouton pas appuyé) {}`, `SDK_DelayAtLeastUs` long…) dans une tâche. La seule tâche longue est l'inférence (quelques dizaines de millisecondes), ce qui reste petit devant la période de 100 ms du trajet.

FreeRTOS est en **bonus** (partie 6.3).

## Partie 4 — Indications

Ces indications vous évitent de perdre du temps sur des points techniques. Elles ne donnent pas la solution : c'est à vous d'assembler les morceaux.

**4.1 Lire l'heure**

Le fichier `source/timer.c` du projet configure déjà le **SysTick** pour produire une interruption toutes les millisecondes, qui incrémente un compteur :

```c
volatile uint32_t msTicks;      /* dans timer.c : +1 toutes les ms */
```

Pour l'utiliser dans vos fichiers : `extern volatile uint32_t msTicks;`. Une tâche périodique peut alors s'écrire avec une variable « prochaine échéance » :

```c
static uint32_t prochaine = 0;
if (msTicks < prochaine) return;    /* pas encore l'heure : on rend la main */
prochaine += PERIODE_MS;            /* echeance suivante */
/* ... travail de la tache ... */
```

**Question :** pourquoi écrire `prochaine += PERIODE_MS` plutôt que `prochaine = msTicks + PERIODE_MS` ? Que se passe-t-il dans chaque cas si la tâche est servie avec 20 ms de retard (pendant une inférence) ?

**4.2 La trajectoire `y = x`**

- La droite `y = x` fait un angle de 45° avec l'axe `x`. En un temps `dt`, le drone parcourt la distance `d = v · dt` **le long de la droite** : il ne faut donc pas ajouter `d` à `x` et à `y` (le drone irait plus vite que `v`). Calculez de combien `x` et `y` augmentent.
- Pour le demi-tour, gardez une variable de **sens** (+1 ou −1).
- **Attention aux nombres à virgule.** Le `PRINTF` du SDK n'affiche pas les `float` par défaut. Deux solutions : travailler en entiers (position en **centimètres** ou en millimètres, `int32_t`), ou afficher la partie entière et la partie décimale séparément. Vérifiez que vos calculs ne perdent pas de précision à chaque pas de 100 ms (erreur qui s'accumule).
- Contrôle simple : à 25 m/s, au bout de 10 s, le drone a parcouru 250 m depuis `(0, 0)` ; calculez `x` et `y` et comparez avec votre affichage.

**4.3 Les LED**

La LED rouge est sur la broche **P0\_10**, la verte sur **P0\_27**. Elles s'allument quand la broche est à **0** (actives à l'état bas). Le fichier `board.h` fournit les macros `LED_RED_INIT`, `LED_RED_ON`, `LED_RED_OFF` (et de même pour `GREEN`). L'exemple ne configure pas ces broches : il faut les passer en GPIO et activer l'horloge du port, une seule fois au démarrage :

```c
#include "board.h"
#include "fsl_port.h"

CLOCK_EnableClock(kCLOCK_Gpio0);
PORT_SetPinMux(PORT0, BOARD_LED_RED_GPIO_PIN, kPORT_MuxAlt0);    /* broche en GPIO */
PORT_SetPinMux(PORT0, BOARD_LED_GREEN_GPIO_PIN, kPORT_MuxAlt0);
LED_RED_INIT(1);      /* sortie, LED eteinte */
LED_GREEN_INIT(1);
```

**4.4 Le bouton SW2 sans attente**

SW2 est sur la broche **P0\_23** (`BOARD_SW2_GPIO`, `BOARD_SW2_GPIO_PIN` dans `board.h`). Elle vaut 1 au repos et 0 quand on appuie. Initialisation :

```c
gpio_pin_config_t entree = {kGPIO_DigitalInput, 0};
CLOCK_EnableClock(kCLOCK_Gpio0);
/* GPIO (MUX 0), tampon d'entree active (IBE), tirage vers le haut (PE + PS) */
PORT0->PCR[BOARD_SW2_GPIO_PIN] = PORT_PCR_MUX(0) | PORT_PCR_IBE_MASK
                               | PORT_PCR_PE_MASK | PORT_PCR_PS_MASK;
GPIO_PinInit(BOARD_SW2_GPIO, BOARD_SW2_GPIO_PIN, &entree);
```

Ensuite, `GPIO_PinRead(BOARD_SW2_GPIO, BOARD_SW2_GPIO_PIN)` donne l'état de la broche. À vous d'écrire une tâche qui **ne bloque pas** : appelée toutes les 10 ms, elle compare l'état actuel à l'état lu la fois précédente, et signale un appui seulement sur le **passage de 1 à 0** (front descendant). Une lecture toutes les 10 ms suffit à filtrer les rebonds.

Autre solution (plus avancée) : une **interruption** sur la broche de SW2. Dans `board.h` : `BOARD_SW2_IRQ` (`GPIO00_IRQn`) et `BOARD_SW2_IRQ_HANDLER` (`GPIO00_IRQHandler`). La routine d'interruption doit rester très courte : elle positionne un drapeau `volatile`, et c'est la tâche Détection qui fait le travail. Voir l'exemple `driver_examples/gpio/input_interrupt` du SDK.

**4.5 Plusieurs images dans la Flash**

Le script ci-dessous convertit plusieurs photos en un seul fichier `images_data.h` : un tableau de 128 × 128 × 3 octets (RGB) par image (`image_0`, `image_1`…), la liste des tableaux `images[]`, la liste des noms `noms_images[]` et leur nombre `NB_IMAGES`. Chaque image occupe 48 Ko de Flash.

```python
# img2c_multi.py : convertit plusieurs images en un seul images_data.h
# Usage : python img2c_multi.py accident_1.jpg pas_accident_1.jpg ...
import os, sys
import cv2

if len(sys.argv) < 2:
    sys.exit("Usage : python img2c_multi.py image1.jpg image2.jpg ...")

noms = []
with open("images_data.h", "w") as f:
    for i, src in enumerate(sys.argv[1:]):
        img = cv2.imread(src)                      # lit en BGR
        if img is None:
            sys.exit("Impossible de lire " + src)
        h, w = img.shape[:2]
        c = min(h, w)                              # recadrage carre centre
        img = img[(h - c) // 2:(h - c) // 2 + c, (w - c) // 2:(w - c) // 2 + c]
        img = cv2.resize(img, (128, 128), interpolation=cv2.INTER_AREA)
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)  # le modele attend du RGB
        f.write("static const uint8_t image_%d[] = {\n" % i)
        img.tofile(f, ", ", "0x%02X")
        f.write("\n};\n\n")
        noms.append(os.path.splitext(os.path.basename(src))[0])
        print("image_%d : %-15s %s = %d octets" % (i, noms[-1], img.shape, img.size))
    n = len(noms)
    f.write("#define NB_IMAGES %d\n" % n)
    f.write("static const uint8_t* const images[NB_IMAGES] = {%s};\n"
            % ", ".join("image_%d" % i for i in range(n)))
    f.write("static const char* const noms_images[NB_IMAGES] = {%s};\n"
            % ", ".join('"%s"' % s for s in noms))
print("images_data.h ecrit :", n, "images")
```

Copier `images_data.h` dans `source/image/`. Dans `image_load.c`, la copie d'une image vers l'entrée du modèle se fait avec :

```c
IMAGE_Decode(images[i], dstData, dstWidth, dstHeight, dstChannels);
```

Réécrivez `IMAGE_GetImage` pour qu'elle prenne simplement l'image suivante à chaque appel, sans rien attendre et sans bloquer.

**4.6 Découper la boucle de `main()`**

- La tâche Détection reprend le contenu actuel de la boucle (`IMAGE_GetImage`, `MODEL_ConvertInput`, `MODEL_RunInference`, `MODEL_ProcessOutput`), mais **seulement** quand un appui a été signalé.
- Notez la **position et l'heure au moment de la photo** (avant l'inférence), pas après : c'est cette position qui part dans le message.
- **Le score accident.** La sortie du modèle (`outputData`) contient un nombre int8 par classe, dans l'ordre de `labels.h`. Le score en % de la classe n° `k` vaut `(sortie[k] + 128) * 100 / 255` : c'est la formule utilisée par la fonction `MODEL_GetTopN` du SDK. Calculez-le pour la classe `accident`, **même quand ce n'est pas la classe gagnante**.
- Une variable partagée avec une routine d'interruption doit être déclarée `volatile`.

**4.7 Construire le message**

`PRINTF` du SDK accepte `%d`, `%u`, `%s`. Construisez le message en **un seul** appel pour qu'il ne soit pas coupé par une autre ligne.

**4.8 Méthode conseillée**

1. Tâche **Trajet seule** (sans modèle) : la position s'affiche chaque seconde et le demi-tour marche.
2. Tâche **Bouton** : afficher « appui » à chaque appui, en vérifiant que la position continue d'avancer.
3. **Détection** branchée sur l'appui, puis **Alerte** et **Communication**.
4. Tableau de tests de la partie 5 rempli au fur et à mesure.

Faites une copie de votre projet à chaque étape qui marche.

## Partie 5 — Tests de validation

Votre compte rendu doit contenir ce tableau, rempli avec **vos** résultats. L'enseignant refera certains tests pendant la démonstration.

| Test | Exigence | Procédure | Résultat attendu | Résultat obtenu |
| --- | --- | --- | --- | --- |
| T1 | F1 | Démarrer la carte (bouton RESET) | Ligne de présentation avec le numéro du drone | |
| T2 | F2 | Laisser tourner 10 s sans toucher à rien | Position affichée chaque seconde ; après 10 s, distance à l'origine = 250 m | |
| T3 | F2 | Laisser tourner jusqu'au bout du tronçon (environ 57 s) | Demi-tour à `x = 1000 m`, retour vers `(0, 0)`, puis nouveau départ | |
| T4 | F3 | Appuyer une fois sur SW2 | Une seule photo analysée, image suivante | |
| T5 | F3 | Garder SW2 appuyé 3 s | Une seule photo ; **la position continue d'avancer** pendant l'appui | |
| T6 | F4, F5, F6 | Photo d'un accident | LED rouge, message `$ACCIDENT` avec la position de la photo | |
| T7 | F4, F5, F6, F7 | Photo sans accident | LED verte, message `$RAS` avec les bons compteurs | |
| T8 | F6 | Comparer la position du message à la position affichée juste avant la photo | Écart inférieur à 2,5 m (une période de 100 ms à 25 m/s) | |
| T9 | F3 | Faire défiler toutes les images | Après la dernière, retour à la première | |
| T10 | Performances | Mesurer le temps d'inférence et l'écart réel entre deux mises à jour de la position (avec `msTicks`) | Période du trajet respectée en moyenne | |

**Démonstration à plusieurs drones.** En fin de séance, deux ou trois binômes voisins font tourner leur drone en même temps, chacun avec son numéro. On lit les messages `[RADIO]` de chaque terminal : à partir des positions envoyées, peut-on dire **quel drone est le plus proche de l'accident** ?

## Partie 6 — Livrables et évaluation

**6.1 À rendre en fin de séance**

| Livrable | Contenu |
| --- | --- |
| Code | Le projet MCUXpresso exporté (**File → Export → Archive File**, format zip), qui compile sans erreur. Le code est commenté : rôle de chaque tâche, unités des variables. |
| Compte rendu (2 à 4 pages, PDF) | Voir 6.2 |
| Démonstration (5 min) | Le drone en marche, les tests T4 à T8 devant l'enseignant, puis questions sur le code |

**6.2 Contenu du compte rendu**

1. **Architecture** : la liste de vos tâches (rôle, période ou événement déclencheur) et la structure du résultat d'une détection.
2. **Trajectoire** : vos formules et les unités choisies.
3. **Modèle** : la précision obtenue dans eIQ Portal, la matrice de confusion, et le nombre d'**accidents manqués** sur les images de test.
4. **Tableau de tests** de la partie 5, avec une capture du terminal pour T6 et T7.
5. **Réponses aux questions** :
    1. Pourquoi une attente du bouton dans une boucle `while` ne respecte-t-elle pas F3 ?
    2. Réponse à la question de l'indication 4.1.
    3. Pourquoi envoyer la position **de la photo** et non la position au moment de l'envoi du message ? Quel écart cela fait-il si le message part 200 ms après la photo ?
    4. Pour ce drone, qu'est-ce qui est le plus grave : une fausse alerte ou un accident manqué ? Quel seuil `SEUIL_ALERTE_ACCIDENT` choisissez-vous, et pourquoi ?
    5. Citez deux limites de cette simulation par rapport à un vrai drone.
6. **Bilan** : ce qui marche, ce qui ne marche pas (un défaut identifié et expliqué vaut mieux qu'un défaut caché).

**6.3 Barème indicatif (sur 20)**

| Critère | Points |
| --- | --- |
| **Fonctionnement** (tests de la partie 5 en démonstration) | **10** |
| — Modèle entraîné, converti et exécuté sur le NPU | 2 |
| — Trajectoire correcte, demi-tour, affichage chaque seconde (F2) | 2 |
| — Bouton non bloquant : le drone avance pendant l'attente et pendant l'appui (F3, T5) | 2 |
| — Détection et LED correctes (F4, F5) | 2 |
| — Messages `[RADIO]` au bon format, avec la position de la photo (F6, F7) | 2 |
| **Qualité du code** : découpage en tâches, aucune attente bloquante, structure de résultat, noms clairs, commentaires, constantes nommées | **4** |
| **Compte rendu** : architecture, tests, réponses aux questions | **4** |
| **Démonstration et questions** : chaque membre du binôme sait expliquer le code | **2** |
| **Bonus** (au plus +2, total plafonné à 20) : voir ci-dessous | +2 |

**Bonus possibles**

- **FreeRTOS** : une vraie tâche FreeRTOS par ligne du tableau 3.1, des **files de messages** (`xQueueSend`, `xQueueReceive`) pour les événements et les résultats, `vTaskDelayUntil` pour la période du trajet. Le SDK 2.14.0 contient les exemples `freertos_examples/freertos_hello` et `freertos_examples/freertos_queue` pour la FRDM-MCXN947. Attention : FreeRTOS utilise lui aussi le SysTick, ce qui entre en conflit avec le `SysTick_Handler` de `timer.c`.
- **Interruption** pour SW2 au lieu d'une lecture périodique (4.4).
- **LED rouge clignotante** à 2 Hz en cas d'accident, sans bloquer les autres tâches.
- **Vraie communication** entre deux cartes (liaison série) : le drone qui reçoit un `$ACCIDENT` affiche sa distance à l'accident.

## Partie 7 — Jeu de données et entraînement du réseau

**7.1 Le jeu de données**

On utilise **Accident Detection from CCTV footage**, publié sur Kaggle et recopié dans le dépôt GitHub [krishrustagi/Accident-Detection-System](https://github.com/krishrustagi/Accident-Detection-System) (dossier `data/`). Il contient environ 990 images tirées de **vidéos de caméras de surveillance routière**, vues en hauteur comme depuis un drone : des routes et des voies rapides, avec ou sans accident (collision, voiture renversée…). Il est déjà rangé en deux classes, `Accident` et `Non Accident`, et en trois parties `train`, `val` et `test`.

Le script ci-dessous télécharge le dépôt (archive d'environ 250 Mo), retire les images en double et les fichiers illisibles, regroupe `train` et `val` pour l'entraînement, garde `test` pour le test, recadre chaque image en carré et la réduit en 128 × 128. Il met aussi de côté **3 photos de test par classe**, en taille d'origine, dans `photos_carte/` : ce sont les photos à mettre dans la Flash (4.5). Elles ne servent pas à l'entraînement.

```
dataset_accident/        <- le dossier a selectionner dans eIQ Portal
├── train/
│   ├── accident/        (415 images)
│   └── pas_accident/    (450 images)
└── test/
    ├── accident/        (47 images)
    └── pas_accident/    (53 images)
```

**7.2 Le script de préparation**

Enregistrer ce script dans un dossier de travail (par exemple `C:\Projet-IA\`), puis lancer `python prepare_dataset_accident.py`. Si le téléchargement échoue (proxy), télécharger l'archive depuis la page GitHub (**Code → Download ZIP**), la renommer `accident_cctv.zip` et la poser à côté du script.

```python
# prepare_dataset_accident.py : telecharge le jeu "Accident Detection from CCTV footage"
# et cree dataset_accident/ (format eIQ Portal) + photos_carte/ (images pour la carte)
# Usage : python prepare_dataset_accident.py
import os, sys, random, shutil, zipfile, hashlib, urllib.request
import cv2
import numpy as np

URL = ("https://github.com/krishrustagi/Accident-Detection-System/"
       "archive/refs/heads/main.zip")
ZIP = "accident_cctv.zip"
SORTIE = "dataset_accident"
CARTE = "photos_carte"
NOMS = {"Accident": "accident", "Non Accident": "pas_accident"}
TAILLE = 128

if not os.path.exists(ZIP):
    print("Telechargement (environ 250 Mo)...")
    urllib.request.urlretrieve(URL, ZIP)

# 1. Lire toutes les images du zip, par classe, sans doublon
vues, images = set(), {c: {"train": [], "test": []} for c in NOMS.values()}
with zipfile.ZipFile(ZIP) as z:
    for nom in sorted(z.namelist()):
        morceaux = nom.split("/")          # .../data/<train|val|test>/<classe>/<fichier>
        if len(morceaux) < 4 or morceaux[-4] != "data" or not morceaux[-1]:
            continue
        split, classe = morceaux[-3], morceaux[-2]
        if classe not in NOMS:
            continue
        octets = z.read(nom)
        md5 = hashlib.md5(octets).hexdigest()
        if md5 in vues:                    # image en double : on l'ignore
            continue
        vues.add(md5)
        partie = "test" if split == "test" else "train"   # val rejoint train
        images[NOMS[classe]][partie].append((morceaux[-1], octets))

# 2. Recadrer en carre, reduire en 128 x 128, ecrire
shutil.rmtree(SORTIE, ignore_errors=True)
shutil.rmtree(CARTE, ignore_errors=True)
os.makedirs(CARTE)
random.seed(0)
for classe, parties in images.items():
    for partie, liste in parties.items():
        dossier = os.path.join(SORTIE, partie, classe)
        os.makedirs(dossier)
        n = 0
        for i, (nom, octets) in enumerate(liste):
            img = cv2.imdecode(np.frombuffer(octets, np.uint8), cv2.IMREAD_COLOR)
            if img is None:                # fichier illisible
                continue
            h, w = img.shape[:2]
            c = min(h, w)
            img = img[(h - c) // 2:(h - c) // 2 + c, (w - c) // 2:(w - c) // 2 + c]
            img = cv2.resize(img, (TAILLE, TAILLE), interpolation=cv2.INTER_AREA)
            cv2.imwrite(os.path.join(dossier, "%s_%04d.jpg" % (classe, i)), img)
            n += 1
        print("%-5s %-13s %4d images" % (partie, classe, n))
    # 3 images de test en taille d'origine pour la carte
    for k, (nom, octets) in enumerate(random.sample(parties["test"], 3)):
        with open(os.path.join(CARTE, "%s_%d.jpg" % (classe, k + 1)), "wb") as f:
            f.write(octets)
print("Termine :", SORTIE, "et", CARTE)
```

Le script doit afficher les 4 lignes de comptage ci-dessus, puis `Termine`. Ouvrez quelques images de chaque dossier pour voir à quoi ressemblent les deux classes.

**Attention :** les images d'une même classe viennent souvent de **la même vidéo**, à quelques images d'intervalle. Le score de test dans eIQ Portal risque donc d'être optimiste. Gardez-le en tête pour la question 4 du compte rendu.

**7.3 Entraîner dans eIQ Portal**

1. **CREATE PROJECT**, puis **IMPORT DATASET** → **Structured folders**, sélectionner `dataset_accident` (le dossier qui contient `train` et `test`), **IMPORT**. Dans le Data Set Curator, vérifier qu'il y a **2 labels**, `accident` et `pas_accident`, et **0** image sans label.
2. **SELECT MODEL** : **Classification**, **Performance**, **MCU**.
3. **TRAIN** : **Input Size** `128,128,3`, **Learning Rate** `0.0001`, **Batch Size** `10`, **Epochs To Train** `10`, le reste par défaut, puis **START TRAINING** (quelques minutes). Regarder les courbes : à partir de quelle époque l'évaluation ne progresse-t-elle plus ?
4. **VALIDATE** : regarder la matrice de confusion. Combien d'accidents sont pris pour `pas_accident` ?

**7.4 Exporter, convertir, intégrer**

1. **DEPLOY** : **TensorFlow Lite**, **Input Data Type : int8**, **Output Data Type : int8**, **Export Quantized Model** activé, **Per Channel**, puis **EXPORT MODEL** → `accident_int8.tflite`. Dans Netron : entrée `int8` `[1, 128, 128, 3]`, sortie `[1, 2]`.
2. Vérifier dans **SETTINGS** que le convertisseur Neutron est réglé sur **MCUXpresso SDK 2.14.0** (la même version que le SDK de la carte, sinon la carte redémarre en boucle).
3. Convertir pour le NPU : **File → Convert → TensorFlow Lite for Neutron**, cible **mcxn94x** → `accident_npu.tflite`. Ou en ligne de commande :

    ```
    neutron-converter --input accident_int8.tflite --output accident_npu.tflite --target mcxn94x
    ```

4. Ouvrir `accident_npu.tflite` dans [Netron](https://netron.app) : noter les opérateurs restés en dehors du `NeutronGraph`, et vérifier qu'ils sont tous déclarés dans `source/model/model_mobilenet_ops_npu.cpp` (une ligne `Add...` par opérateur).
5. Mettre le modèle dans `source/model/model_data.h` avec le script suivant (il garde l'en-tête du fichier d'origine et remplace le tableau `model_data[]`) :

    ```python
    # tflite2h.py : met un modele .tflite dans model_data.h (projet tflm_label_image)
    # Usage : python tflite2h.py model_data_origine.h accident_npu.tflite
    import os, sys

    if len(sys.argv) != 3:
        sys.exit("Usage : python tflite2h.py model_data_origine.h modele.tflite")
    modele = open(sys.argv[2], "rb").read()
    texte = open(sys.argv[1]).read()
    debut = texte.index("model_data[]")              # declaration du tableau
    debut = texte.index("{", debut) + 1              # juste apres l'accolade
    entete = texte[:debut]
    nom = os.path.splitext(os.path.basename(sys.argv[2]))[0]
    lignes = []
    for i in range(0, len(modele), 12):
        lignes.append("  " + ", ".join("0x%02x" % b for b in modele[i:i + 12]) + ",")
    with open("model_data.h", "w") as f:
        f.write(entete.replace(entete.split('#define MODEL_NAME "')[1].split('"')[0], nom))
        f.write("\n" + "\n".join(lignes) + "\n};\n")
    print("model_data.h ecrit :", nom, len(modele), "octets")
    ```

    Copier `source/model/model_data.h` dans un dossier `tools/` sous le nom `model_data_origine.h`, y copier `accident_npu.tflite`, lancer `python tflite2h.py model_data_origine.h accident_npu.tflite`, puis copier le `model_data.h` obtenu dans `source/model/`.

6. Dans `source/labels.h`, remplacer les 1001 classes d'origine par les vôtres, **dans l'ordre alphabétique** (celui d'eIQ Portal) : `"accident"`, puis `"pas_accident"`. La sortie n° 0 du modèle est donc `accident`.

**Dépannage**

| Symptôme | Cause probable | Solution |
| --- | --- | --- |
| La carte redémarre en boucle | Convertisseur Neutron et SDK de versions différentes | 7.4 étape 2, puis reconvertir |
| `Didn't find op for builtin opcode ...` | Opérateur manquant dans `model_mobilenet_ops_npu.cpp` | 7.4 étape 4 |
| `AllocateTensors() failed` | Mémoire de travail `kTensorArenaSize` trop petite | L'augmenter dans `model_data.h` (le message indique la taille nécessaire) |
| La LED d'alerte est allumée à l'envers | Ordre des classes dans `labels.h` | 7.4 étape 6 |
| `images_data.h: No such file or directory` | Fichier pas copié dans `source/image/` ou pas de **Refresh** | Copier le fichier, puis **F5** sur le projet |
| Un appui fait sauter plusieurs images | Rebonds du bouton | 4.4 |
| Les LED ne s'allument pas | Broches pas configurées en GPIO | 4.3 |

**À vérifier selon votre installation :** ce sujet suit le projet `tflm_label_image` du SDK FRDM-MCXN947 **2.14.0** (`source/main.cpp`, `source/timer.c` avec `msTicks`, `source/model/model_data.h`, macros `LED_...` et `BOARD_SW2_...` dans `board.h`). Avec une autre version du SDK, les noms peuvent changer.

**À propos du jeu de données :** le jeu « Accident Detection from CCTV footage » est publié sur Kaggle, et le dépôt GitHub qui le recopie n'indique pas de licence. Les images viennent de vidéos publiques. On l'utilise ici dans un cadre pédagogique : ne redistribuez pas les images.

**Sources :** [Dépôt Accident-Detection-System (jeu de données dans `data/`)](https://github.com/krishrustagi/Accident-Detection-System) · [Exemples MCUXpresso SDK 2.14.0 pour MCX N (tflm\_label\_image, freertos\_examples, gpio)](https://github.com/nxp-mcuxpresso/mcux-sdk-examples/tree/MCUX_2.14.0_MCXNx4x/frdmmcxn947) · [Compatibilité Neutron SDK / MCUXpresso SDK](https://eiq.nxp.com/learning-hub/tools/neutronSdk/userGuide/mcuxCompatMatrix.html) · [NXP — MCXN947: How to Train and Deploy Customer ML model to NPU](https://community.nxp.com/t5/MCX-Microcontrollers-Knowledge/MCXN947-How-to-Train-and-Deploy-Customer-ML-model-to-NPU/ta-p/1899497) · [FreeRTOS](https://www.freertos.org/) · [Netron](https://netron.app)
