# Corrigé — TP2 : Entraîner son propre modèle avec eIQ Portal

Valeurs mesurées par l'enseignant le 23/11/2026 (eIQ Toolkit 1.17, SDK FRDM-MCXN947 2.14.0, MCUXpresso IDE 11.9.0, configuration Debug). Les résultats des étudiants varieront de quelques points.

## Fichiers du corrigé

| Fichier | Contenu |
| --- | --- |
| [prepare\_dataset.py](fichiers/prepare_dataset.py) | Script de la partie 1 |
| [fleurs\_int8.tflite](fichiers/fleurs_int8.tflite) | Modèle exporté par eIQ Portal (int8, pour CPU), 601 Ko |
| [fleurs\_npu.tflite](fichiers/fleurs_npu.tflite) | Modèle converti pour le NPU (Neutron, SDK 2.14.0), 429 Ko |

## Parties 1 à 4 — Jeu de données et entraînement

- Jeu de données : 5 classes, 240 images en Train et 60 en Test par classe (1 500 images).
- Modèle de base choisi par eIQ Portal : **MobileNet V2, Alpha 0.35** (`classification-performance-mcu`).
- Réglages : imagenet, entrée `128,128,3`, Learning Rate 0.0001, Batch Size 10, 10 époques.
- Durée : **120 s** pour 10 époques sur PC portable sans GPU.
- Précision finale : **0,97** en entraînement, **0,90** en évaluation.
- Lecture des courbes : après la 6e époque, l'évaluation plafonne (précision 0,9, perte vers 0,45) alors que l'entraînement progresse encore. C'est un début de surapprentissage : plus d'époques n'aideraient pas.

## Partie 5 — Validation

| Classe | Précision (float32) |
| --- | --- |
| marguerite | 91,67 % |
| pissenlit | 85,00 % |
| rose | 80,00 % |
| tournesol | 88,33 % |
| tulipe | 91,67 % |
| **Moyenne** | **87,3 %** |

**Q1. Classes les plus confondues.** `rose` est la classe la plus faible (80 %), confondue surtout avec `tulipe` : mêmes couleurs (rouge, rose), pétales en coupe, photos souvent en massif. `pissenlit` (85 %) est confondu avec `marguerite` et `tournesol` : cœur jaune ou fleur jaune.

**Q2 (bonus). Perte due à l'int8.** Elle est en général de 0 à 2 points avec la quantification Per Channel. On l'accepte car le modèle est 4 fois plus petit et le NPU ne calcule qu'en int8 : le gain de vitesse et de mémoire est bien plus grand que la perte.

## Parties 6 et 7 — Export et conversion

| Fichier | Taille | Opérateurs (Netron) |
| --- | --- | --- |
| `fleurs_int8.tflite` | 601 Ko | 35 `Conv2D`, 17 `DepthwiseConv2D`, 10 `Add`, `Mean`, `FullyConnected`, `Softmax` |
| `fleurs_npu.tflite` | 429 Ko | 1 `NeutronGraph` + `Slice`, `Reshape`, `Softmax` |

- Entrée : `int8 [1, 128, 128, 3]`, scale 1/127,5, zero point −1. Le firmware soustrait 128 au pixel : le pixel p devient la valeur réelle (p − 127) / 127,5, soit environ −1 à +1. C'est bien la normalisation de MobileNet V2.
- Sortie : `int8 [1, 5]`, scale 1/256, zero point −128 (score de 0 à 1).
- Toutes les couches de calcul sont dans le `NeutronGraph`. Seuls le découpage, le reshape et le softmax final restent sur le CPU.

## Partie 8 — Intégration

Ops resolver suffisant pour `fleurs_npu.tflite` (les mêmes opérateurs que le modèle du TP1) :

```cpp
tflite::MicroOpResolver &MODEL_GetOpsResolver()
{
    static tflite::MicroMutableOpResolver<4> s_microOpResolver;

    s_microOpResolver.AddReshape();
    s_microOpResolver.AddSlice();
    s_microOpResolver.AddSoftmax();
    s_microOpResolver.AddCustom(tflite::GetString_NEUTRON_GRAPH(),
                                tflite::Register_NEUTRON_GRAPH());

    return s_microOpResolver;
}
```

`labels.h` : `"marguerite", "pissenlit", "rose", "tournesol", "tulipe"` (ordre alphabétique, celui d'eIQ Portal).

`model_data.h` : `MODEL_NAME` changé, `kTensorArenaSize` passé à `300 * 1024`. Le modèle demande 294 960 octets ; la valeur d'origine (prévue pour le modèle du TP1) ne laisse que 261 608 octets et provoque `AllocateTensors() failed`.

## Partie 9 — Test sur la carte

Résultat mesuré : **tournesol (80 %) en 16 ms** sur le NPU.

**Q1. Temps d'inférence.** Il ne dépend pas de l'image : le réseau fait exactement les mêmes calculs quel que soit le contenu des pixels. 16 ms contre 12 ms au TP1 : MobileNet V2 Alpha 0.35 fait plus de calculs que MobileNet V1 Alpha 0.25.

**Q2. Image qui n'est pas une fleur.** Le modèle répond quand même une des 5 fleurs. Le softmax répartit 100 % entre les 5 classes connues : il n'y a pas de classe « autre ». Le score est souvent plus bas, et un seuil (`DETECTION_TRESHOLD`) ou une 6e classe « pas une fleur » permettrait de rejeter ces images.

**Q3. Cohérence avec la validation.** Oui : environ 87 % de bonnes réponses en validation, donc environ 1 erreur sur 8 images. Les erreurs sur la carte tombent surtout sur `rose` et `pissenlit`.

## Questions de synthèse

1. `prepare_dataset.py` → `dataset_fleurs/` ; eIQ Portal (entraînement) → projet `.eiqp` ; eIQ Portal (DEPLOY) → `fleurs_int8.tflite` ; Model Tool (convertisseur Neutron) → `fleurs_npu.tflite` ; `swap_model.py` → `model_data.h` ; MCUXpresso IDE → firmware `.axf` flashé sur la carte.
2. Les images de test mesurent si le modèle sait reconnaître des images **qu'il n'a jamais vues**. Mesurer sur les images d'entraînement donnerait une précision trop optimiste (0,97 au lieu de 0,90 ici).
3. Le NPU Neutron ne calcule qu'en entiers 8 bits. Le convertisseur n'accepte donc que des modèles déjà quantifiés en int8.
4. Le modèle donne la bonne sortie, mais le firmware affiche le mauvais nom. Les erreurs sont « décalées » de façon systématique (par exemple toujours `tulipe` pour une rose).
5. Sur le CPU restent `Slice`, `Reshape` et `Softmax`. Toutes les convolutions, les additions, la moyenne et la couche dense sont dans le `NeutronGraph`.
