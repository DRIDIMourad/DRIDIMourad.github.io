# Projet : Drone de surveillance des départs de feu (FRDM-MCXN947)


## Présentation

Ce projet est **évalué**. Contrairement aux TP, il ne donne pas toutes les étapes : il fixe **ce que le système doit faire** (le cahier des charges) et donne des **indications**. À vous de concevoir l'architecture, d'écrire le code, de le tester et de justifier vos choix.

**Le scénario.** Une flotte de petits drones survole une forêt pour repérer les départs de feu. Chaque drone suit une trajectoire, prend des photos et les analyse **à bord**, avec un réseau de neurones exécuté sur le NPU : pas de liaison vidéo vers le sol, seulement des messages courts. Quand un drone voit un feu, il allume son voyant rouge et **prévient les drones voisins** en leur envoyant **sa position**. Sinon, son voyant reste vert.

**Dans ce projet, le drone est la carte FRDM-MCXN947.** Comme on n'a ni drone, ni caméra, ni radio, on les **simule** :

| Élément réel | Simulation sur la carte |
| --- | --- |
| Moteurs et GPS | Une tâche qui calcule la position du drone le long d'une trajectoire droite (`y = x`) à vitesse constante |
| Caméra | Les images stockées dans la Flash (`images_data.h`, TP3 partie 8). Un appui sur **SW2** = le drone prend une nouvelle photo |
| Réseau de neurones | Le modèle `feu` / `pas_de_feu` du TP3, exécuté sur le NPU Neutron |
| Voyant d'alerte | La LED RGB de la carte : **rouge** si feu, **verte** sinon |
| Radio vers les drones voisins | Des messages affichés dans le **terminal série** (115200 8N1) |

**Prérequis.** Le TP3 terminé jusqu'à la partie 8 : modèle `feu_npu.tflite` intégré, LED d'alerte (partie 7), plusieurs images et bouton SW2 (partie 8). Le projet part de **votre** projet `tflm_label_image` du TP3.

**Organisation**

| | |
| --- | --- |
| Travail | En binôme |
| Durée indicative | 3 séances de 3 h, plus le travail personnel |
| Matériel | Une FRDM-MCXN947 par binôme, câble USB-C sur **MCU-Link (J17)** |
| Logiciel | MCUXpresso IDE, SDK FRDM-MCXN947 **2.14.0** avec eIQ, eIQ Toolkit 1.17, Python 3 (comme au TP3) |
| Livrables | Code, rapport, démonstration (voir la partie 6) |

**Objectifs pédagogiques.** À la fin du projet, vous savez :

- découper une application embarquée en **tâches** qui ont chacune leur rôle et leur rythme ;
- faire cohabiter une tâche **périodique** (le trajet) et des tâches **déclenchées par un événement** (le bouton, la détection) sans qu'une tâche en bloque une autre ;
- utiliser le résultat d'un réseau de neurones pour **décider et agir** (LED, message) ;
- définir un **format de message** et l'utiliser entre plusieurs systèmes ;
- **tester** un système et mesurer ses performances (temps d'inférence, respect des périodes).

## Partie 1 — Cahier des charges fonctionnel

Chaque exigence a un identifiant (`F1`, `F2`…). Utilisez ces identifiants dans votre rapport et dans votre tableau de tests (partie 5).

**F1 — Identité du drone**

- Chaque drone a un **numéro** `ID_DRONE` (de 1 à 99), défini par une constante dans le code. Chaque binôme prend le numéro de sa carte (donné par l'enseignant).
- Au démarrage, le drone affiche une ligne de présentation : son numéro, sa vitesse, sa position de départ, le seuil d'alerte.

**F2 — Trajectoire**

- Le drone part du point `(0, 0)` et avance **le long de la droite `y = x`** à la vitesse `VITESSE_DRONE`, en mètres par seconde (valeur par défaut : **5 m/s**).
- La position `(x, y)` est mise à jour **toutes les 100 ms**. Les distances sont en mètres, avec au moins une précision de 1 cm.
- La zone surveillée est le carré de 0 à 200 m. Quand le drone atteint le bord (`x = 200 m`), il **fait demi-tour** et repart vers `(0, 0)`, puis repart à nouveau, et ainsi de suite (aller-retour).
- Toutes les **secondes**, le drone affiche sa position et le temps écoulé depuis le démarrage.

**F3 — Prise de photo**

- Chaque appui sur **SW2** correspond à une photo prise **à la position actuelle** du drone.
- Les images défilent dans l'ordre de `images_data.h` ; après la dernière, on revient à la première.
- Un appui doit compter pour **une seule** photo (gérer les rebonds du bouton).
- **Le drone ne s'arrête pas d'avancer** pendant qu'il attend un appui : la position continue à être mise à jour toutes les 100 ms. C'est l'exigence la plus importante du projet (voir la partie 3).

**F4 — Détection**

- Chaque photo est analysée par le modèle du TP3, sur le NPU.
- Le drone calcule le **score feu** (en %) et le compare au seuil `SEUIL_ALERTE_FEU` (partie 7 du TP3).
- Il affiche : le nom de l'image, la position de la photo, la classe trouvée, le score feu et le temps d'inférence.

**F5 — Alerte locale (LED)**

- Feu détecté : LED **rouge** allumée, LED verte éteinte.
- Pas de feu : LED **verte** allumée, LED rouge éteinte.
- La LED garde son état jusqu'à la photo suivante.

**F6 — Communication avec les drones voisins**

- En cas de feu, le drone **envoie un message d'alerte** à ses voisins, avec **sa position au moment de la photo**. La radio est simulée : le message est affiché dans le terminal, sur une ligne qui commence par `[RADIO]`.
- Le message suit **exactement** le format de la partie 2, pour qu'un autre programme puisse le lire.
- Le drone envoie aussi un message d'état `RAS` (rien à signaler) après chaque photo sans feu.

**F7 — Bilan**

- Le drone compte les photos analysées et les alertes envoyées. Ces deux compteurs apparaissent dans chaque message d'état (partie 2).

**Ce que vous pouvez choisir.** Tout ce qui n'est pas écrit ci-dessus est libre : noms des fonctions, découpage des fichiers, textes affichés (sauf les messages `[RADIO]`), méthode de calcul de la trajectoire, façon de lire le bouton. Chaque choix important doit être **justifié dans le rapport**.

## Partie 2 — Format des messages radio

Les messages vers les drones voisins tiennent sur **une ligne**, commencent par `[RADIO] $`, et les champs sont séparés par des virgules (inspiré des trames NMEA des GPS). Les nombres sont des **entiers**.

**Message d'alerte (F6)**

```
[RADIO] $ALERTE,<id>,<t_ms>,<x_cm>,<y_cm>,<score>,<image>
```

**Message d'état après une photo sans feu (F6, F7)**

```
[RADIO] $RAS,<id>,<t_ms>,<x_cm>,<y_cm>,<nb_photos>,<nb_alertes>
```

| Champ | Signification | Exemple |
| --- | --- | --- |
| `id` | Numéro du drone (`ID_DRONE`) | `7` |
| `t_ms` | Temps depuis le démarrage, en millisecondes, **au moment de la photo** | `12400` |
| `x_cm`, `y_cm` | Position du drone **au moment de la photo**, en centimètres | `4384`, `4384` |
| `score` | Score feu en % | `97` |
| `image` | Nom de l'image analysée | `feu_1` |
| `nb_photos`, `nb_alertes` | Compteurs de F7 | `3`, `1` |

**Exemple de terminal attendu** (les valeurs sont données à titre d'exemple ; les autres lignes sont libres) :

```
Drone 7 : depart (0.00 m, 0.00 m), vitesse 5 m/s, seuil feu 50 %
[t=1.0 s] position (3.53 m, 3.53 m)
[t=2.0 s] position (7.07 m, 7.07 m)
...
Photo 1 (feu_1) a (43.84 m, 43.84 m) : feu, score feu 97 %, 16 ms
[RADIO] $ALERTE,7,12400,4384,4384,97,feu_1
[t=13.0 s] position (45.96 m, 45.96 m)
...
Photo 2 (pas_de_feu_1) a (56.57 m, 56.57 m) : pas_de_feu, score feu 3 %, 16 ms
[RADIO] $RAS,7,16000,5657,5657,2,1
```

## Partie 3 — Architecture logicielle

Le projet `tflm_label_image` est construit autour d'une **boucle** dans `main()` (fichier `source/main.cpp`) :

```
while (1)
    IMAGE_GetImage()       <- au TP3 : attend l'appui sur SW2 (bloquant)
    MODEL_ConvertInput()
    MODEL_RunInference()   <- environ 16 ms sur le NPU
    MODEL_ProcessOutput()  <- affichage + LED
```

Avec le code du TP3, la carte reste bloquée dans `BOUTON_Attendre()` tant qu'on n'appuie pas sur SW2 : rien d'autre ne peut se passer. Un drone qui s'arrête en l'air chaque fois qu'il attend une photo, ce n'est pas acceptable (exigence **F3**). Il faut donc **réorganiser le programme en tâches**.

**3.1 Les tâches à réaliser**

Votre programme doit contenir au moins les tâches suivantes. Une « tâche » est une fonction qui a un rôle précis et qui ne bloque jamais les autres.

| Tâche | Rôle | Déclenchement | Exigences |
| --- | --- | --- | --- |
| **Trajet** | Mettre à jour `(x, y)` et gérer le demi-tour ; afficher la position chaque seconde | Périodique, toutes les 100 ms | F2 |
| **Bouton** | Détecter un **nouvel** appui sur SW2, sans attendre | Périodique (par exemple toutes les 10 ms) ou interruption | F3 |
| **Détection** | Charger l'image suivante, noter la position et l'heure de la photo, lancer l'inférence, calculer le score feu | Sur un appui (événement venant de la tâche Bouton) | F3, F4 |
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

Le **résultat** d'une détection regroupe au moins : la classe, le score feu, le nom de l'image, la position et l'heure de la photo. Pensez à le ranger dans une **structure** C (`struct`).

**3.3 Architecture imposée (base) : super-boucle non bloquante**

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

**Règle d'or : aucune boucle d'attente** (`while (bouton pas appuyé) {}`, `SDK_DelayAtLeastUs` long…) dans une tâche. La seule tâche longue est l'inférence (environ 16 ms), ce qui reste petit devant la période de 100 ms du trajet.

**3.4 Bonus : FreeRTOS**

Les binômes qui ont fini la base peuvent refaire l'architecture avec **FreeRTOS** : une vraie tâche FreeRTOS par ligne du tableau 3.1, des **files de messages** (`xQueueSend`, `xQueueReceive`) pour faire passer les événements et les résultats, `vTaskDelayUntil` pour la période du trajet. Voir la partie 4.6 pour les indications.

## Partie 4 — Indications

Les indications ci-dessous vous évitent de perdre du temps sur des points techniques. Elles ne donnent pas la solution : c'est à vous d'assembler les morceaux.

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

**Question :** pourquoi écrire `prochaine += PERIODE_MS` plutôt que `prochaine = msTicks + PERIODE_MS` ? Que se passe-t-il dans chaque cas si la tâche est servie avec 16 ms de retard (pendant une inférence) ?

**4.2 La trajectoire `y = x`**

- La droite `y = x` fait un angle de 45° avec l'axe `x`. En un temps `dt`, le drone parcourt la distance `d = v · dt` **le long de la droite** : il ne faut donc pas ajouter `d` à `x` et à `y` (le drone irait plus vite que `v`). Calculez de combien `x` et `y` augmentent.
- Pour le demi-tour, gardez une variable de **sens** (+1 ou −1).
- **Attention aux nombres à virgule.** Le `PRINTF` du SDK n'affiche pas les `float` par défaut. Deux solutions : travailler en entiers (position en **centimètres** ou en millimètres, `int32_t`), ou afficher la partie entière et la partie décimale séparément. Les entiers sont plus simples et plus rapides sur un microcontrôleur. Vérifiez que vos calculs ne perdent pas de précision à chaque pas de 100 ms (erreur qui s'accumule).
- Contrôle simple : à 5 m/s, au bout de 10 s, le drone a parcouru 50 m depuis `(0, 0)` ; calculez `x` et `y` et comparez avec votre affichage.

**4.3 Le bouton sans attente**

Reprendre `BOUTON_Init()` du TP3 (partie 8.3), mais remplacer `BOUTON_Attendre()` par une fonction qui **ne bloque pas** : appelée toutes les 10 ms, elle compare l'état actuel de SW2 (`GPIO_PinRead`) à l'état lu la fois précédente, et signale un appui seulement sur le **passage de 1 à 0** (front descendant). Une lecture toutes les 10 ms suffit à filtrer les rebonds.

Autre solution (plus avancée) : une **interruption** sur la broche de SW2. Dans `board.h` : `BOARD_SW2_IRQ` (`GPIO00_IRQn`) et `BOARD_SW2_IRQ_HANDLER` (`GPIO00_IRQHandler`). La routine d'interruption doit rester très courte : elle positionne un drapeau `volatile`, et c'est la tâche Détection qui fait le travail. Voir l'exemple `driver_examples/gpio/input_interrupt` du SDK.

**4.4 Découper la boucle de `main()`**

- La tâche Détection reprend le contenu actuel de la boucle (`IMAGE_GetImage`, `MODEL_ConvertInput`, `MODEL_RunInference`, `MODEL_ProcessOutput`), mais **seulement** quand un appui a été signalé.
- `IMAGE_GetImage` ne doit plus attendre le bouton : modifiez `image_load.c` du TP3 pour qu'il passe simplement à l'image suivante à chaque appel.
- Notez la **position et l'heure au moment de la photo** (avant l'inférence), pas après : c'est cette position qui part dans le message.
- `MODEL_ProcessOutput` (dans `output_postproc.cpp`) allume déjà les LED au TP3. Décidez où vous voulez que la LED soit commandée (dans `MODEL_ProcessOutput` ou dans votre tâche Alerte) et justifiez. Si vous avez besoin du score feu hors de `output_postproc.cpp`, faites-le remonter (variable globale, fonction qui le renvoie, champ d'une structure…).
- Une variable partagée entre deux tâches doit être `volatile` si elle est modifiée dans une interruption.

**4.5 Construire le message**

`PRINTF` du SDK accepte `%d`, `%u`, `%s`. Construisez le message en un seul appel pour qu'il ne soit pas coupé par une autre ligne. Si vos positions sont des entiers en centimètres, les champs `x_cm` et `y_cm` s'affichent directement.

**4.6 Pour le bonus FreeRTOS**

- Le SDK 2.14.0 contient des exemples FreeRTOS pour la FRDM-MCXN947 : `freertos_examples/freertos_hello` (créer des tâches) et `freertos_examples/freertos_queue` (files de messages). Importez-en un pour voir comment le projet est configuré (fichier `FreeRTOSConfig.h`, composant `freertos-kernel`).
- Pour l'ajouter à votre projet : clic droit sur le projet → **SDK Management** → **Manage SDK Components**, cocher **FreeRTOS kernel**, puis copier un `FreeRTOSConfig.h` depuis un exemple.
- **Conflit à prévoir :** FreeRTOS utilise lui aussi le SysTick. Le `SysTick_Handler` de `timer.c` entre en conflit avec celui de FreeRTOS. Il faut choisir : soit mesurer le temps avec `xTaskGetTickCount()`, soit utiliser un autre timer pour `TIMER_GetTimeInUS()`.
- Prévoir une **pile** suffisante pour la tâche qui fait l'inférence (plusieurs Ko), et une priorité plus haute pour la tâche Trajet que pour la tâche Détection. Justifiez ces choix.

**4.7 Méthode conseillée**

1. Écrire et tester la tâche **Trajet seule** (sans modèle) : la position s'affiche chaque seconde et le demi-tour marche.
2. Ajouter la tâche **Bouton** : afficher « appui » à chaque appui, en vérifiant que la position continue d'avancer.
3. Brancher la **Détection** sur l'appui, puis l'**Alerte** et la **Communication**.
4. Remplir le tableau de tests de la partie 5 au fur et à mesure.
5. Seulement ensuite : bonus.

Faites une copie de votre projet (ou un commit Git) à chaque étape qui marche.

## Partie 5 — Tests de validation

Votre rapport doit contenir ce tableau, rempli avec **vos** mesures. L'enseignant refera certains tests pendant la démonstration.

| Test | Exigence | Procédure | Résultat attendu | Résultat obtenu |
| --- | --- | --- | --- | --- |
| T1 | F1 | Démarrer la carte (bouton RESET) | Ligne de présentation avec le numéro du drone | |
| T2 | F2 | Laisser tourner 10 s sans toucher à rien | Position affichée chaque seconde ; après 10 s, distance à l'origine = 50 m (à 5 m/s) | |
| T3 | F2 | Laisser tourner jusqu'au bord de la zone | Demi-tour à `x = 200 m`, retour vers `(0, 0)`, puis nouveau départ | |
| T4 | F3 | Appuyer une fois sur SW2 | Une seule photo analysée, image suivante | |
| T5 | F3 | Garder SW2 appuyé 3 s | Une seule photo ; **la position continue d'avancer** pendant l'appui | |
| T6 | F4, F5, F6 | Photo d'un feu | LED rouge, message `$ALERTE` avec la position de la photo | |
| T7 | F4, F5, F6, F7 | Photo sans feu | LED verte, message `$RAS` avec les bons compteurs | |
| T8 | F6 | Comparer la position du message à la position affichée juste avant la photo | Moins de 0,5 m d'écart (une période de 100 ms à 5 m/s) | |
| T9 | F3 | Faire défiler toutes les images | Après la dernière, retour à la première | |
| T10 | Performances | Mesurer le temps d'inférence et l'écart réel entre deux mises à jour de la position (avec `msTicks`) | Inférence ≈ 16 ms ; période du trajet respectée en moyenne | |

**Démonstration à plusieurs drones.** Pendant la démonstration, deux ou trois binômes voisins font tourner leur drone en même temps, chacun avec son numéro. On lit les messages `[RADIO]` de chaque terminal : à partir des positions envoyées, peut-on dire **quel drone est le plus proche du feu** ? (Question 6 du rapport.)

## Partie 6 — Livrables et évaluation

**6.1 À rendre**

| Livrable | Contenu |
| --- | --- |
| Code | Le projet MCUXpresso exporté (**File → Export → Archive File**, format zip), qui compile sans erreur. Le code est commenté : rôle de chaque tâche, unités des variables. |
| Rapport (6 à 10 pages, PDF) | Voir 6.2 |
| Démonstration (10 min) | Le drone en marche, les tests T4 à T8 devant l'enseignant, puis questions sur le code |

Date de rendu et modalités : précisées par l'enseignant.

**6.2 Contenu du rapport**

1. **Architecture** : la liste de vos tâches (rôle, période ou événement déclencheur), un schéma de ce qu'elles s'échangent, et les structures de données partagées.
2. **Chronogramme** : un schéma sur une seconde qui montre quand chaque tâche s'exécute, avec un appui sur SW2 au milieu.
3. **Trajectoire** : vos formules, les unités choisies, le traitement du demi-tour et de la précision.
4. **Tableau de tests** de la partie 5, avec une capture du terminal pour T6 et T7.
5. **Mesures** : temps d'inférence, période réelle du trajet, taille du programme (Flash, RAM) relevée dans le résumé de compilation.
6. **Réponses aux questions** :
    1. Pourquoi le code du TP3 (attente bloquante du bouton) ne respecte-t-il pas F3 ?
    2. Réponse à la question de l'indication 4.1 (échéance qui dérive ou non).
    3. Que se passerait-il pour la trajectoire si l'inférence durait 300 ms au lieu de 16 ms (par exemple sur le CPU sans NPU, voir le TP1) ? Comment le corriger ?
    4. Pourquoi envoyer la position **de la photo** et non la position au moment de l'envoi du message ? Quel écart cela fait-il à 5 m/s ? Et pour un vrai drone à 15 m/s avec une transmission de 200 ms ?
    5. Un drone voisin reçoit 3 messages `$ALERTE` pour la même zone en 10 s. Un seul message `$ALERTE` isolé, entouré de `$RAS`. Lequel croire, et pourquoi ? (Pensez aux fausses alarmes du TP3.)
    6. Pendant la démonstration à plusieurs drones, comment décider quel drone doit aller vérifier le feu ?
    7. Quelles limites a cette simulation par rapport à un vrai drone (énergie, radio, caméra qui bouge, images floues…) ?
7. **Bilan** : ce qui marche, ce qui ne marche pas (soyez honnêtes : un défaut identifié et expliqué vaut mieux qu'un défaut caché), répartition du travail dans le binôme.

**6.3 Barème indicatif (sur 20)**

| Critère | Points |
| --- | --- |
| **Fonctionnement** (tests de la partie 5 en démonstration) | **8** |
| — Trajectoire correcte, demi-tour, affichage chaque seconde (F2) | 2 |
| — Bouton non bloquant : le drone avance pendant l'attente et pendant l'appui (F3, T5) | 2 |
| — Détection et LED correctes (F4, F5) | 2 |
| — Messages `[RADIO]` au bon format, avec la position de la photo (F6, F7) | 2 |
| **Qualité du code** : découpage en tâches, aucune attente bloquante, structures, noms clairs, commentaires, constantes nommées | **4** |
| **Rapport** : architecture, chronogramme, tests, mesures, réponses aux questions | **5** |
| **Démonstration et questions** : chaque membre du binôme sait expliquer tout le code | **3** |
| **Bonus** (au plus +3, total plafonné à 20) : FreeRTOS (4.6), interruption pour SW2, classe `accident` (partie 7), LED rouge clignotante, réception de messages d'un autre drone (partie 7) | +3 |

## Partie 7 — Pour aller plus loin (bonus)

**B.1 FreeRTOS.** Voir les parties 3.4 et 4.6. Dans le rapport, comparez les deux versions : lignes de code, taille Flash/RAM, régularité de la période du trajet.

**B.2 Détecter aussi les accidents.** Ajouter une classe `accident` (accident de la route vu du ciel ou par une caméra de surveillance) : trouver un jeu de données (par exemple sur Kaggle, en cherchant « accident detection »), vérifier sa licence, le préparer au format eIQ Portal comme au TP3 (partie 1), entraîner un modèle à 3 classes, et ajouter un message `$ACCIDENT` au format de la partie 2. Attention à l'ordre alphabétique des classes dans `labels.h`. On peut allumer la LED **bleue** pour un accident (TP3, bonus B.1).

**B.3 Voyant clignotant.** En cas de feu, la LED rouge **clignote** à 2 Hz au lieu de rester fixe, sans bloquer les autres tâches (c'est une tâche périodique de plus).

**B.4 Vraie communication entre deux cartes.** Relier deux cartes par une liaison série (UART) ou les faire communiquer à travers le PC (un script Python qui lit le terminal d'un drone et écrit dans celui de l'autre). Le drone qui reçoit un `$ALERTE` affiche la distance entre lui et le feu signalé.

**B.5 Économie d'énergie.** Pendant l'attente, mettre le processeur en veille (`__WFI()`) entre deux interruptions du SysTick. Expliquer pourquoi c'est important pour un drone sur batterie.

## Rappels et sources

**Rappels utiles des TP précédents**

| Besoin | Où le retrouver |
| --- | --- |
| Modèle `feu_npu.tflite`, `labels.h`, ops resolver, `kTensorArenaSize` | TP3, partie 6 |
| LED rouge P0\_10, verte P0\_27 (actives à l'état bas), `LED_Init()`, score feu | TP3, partie 7 |
| Plusieurs images (`img2c_multi.py`, `images_data.h`), bouton SW2 sur P0\_23 | TP3, partie 8 |
| Choix du seuil, faux positifs et faux négatifs | TP3, parties 0 et 9 |
| La carte redémarre en boucle (versions du convertisseur Neutron) | TP2, partie 7.1 |

**À vérifier selon votre installation :** ce sujet suit le projet `tflm_label_image` du SDK FRDM-MCXN947 **2.14.0** (`source/main.cpp`, `source/timer.c` avec `msTicks`, macros `BOARD_SW2_...` dans `board.h`). Avec une autre version du SDK, les noms peuvent changer.

**Sources :** [Exemples MCUXpresso SDK 2.14.0 pour MCX N (tflm\_label\_image, freertos\_examples, gpio)](https://github.com/nxp-mcuxpresso/mcux-sdk-examples/tree/MCUX_2.14.0_MCXNx4x/frdmmcxn947) · [FreeRTOS (documentation : tâches, files de messages)](https://www.freertos.org/) · [Trames NMEA 0183 (format des messages GPS)](https://fr.wikipedia.org/wiki/NMEA_0183)
