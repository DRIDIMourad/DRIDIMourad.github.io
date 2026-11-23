# prepare_dataset.py : telecharge flower_photos et cree dataset_fleurs/ pour eIQ Portal
# Usage : python prepare_dataset.py [nombre_images_par_classe]
import os, sys, random, shutil, tarfile, urllib.request
import cv2

URL = "https://storage.googleapis.com/download.tensorflow.org/example_images/flower_photos.tgz"
N_PAR_CLASSE = int(sys.argv[1]) if len(sys.argv) > 1 else 300
PART_TEST = 0.2          # 20 % des images dans test/
N_CARTE = 3              # photos gardees a part pour tester sur la carte
TAILLE = 128             # taille d'entree du modele
NOMS = {"daisy": "marguerite", "dandelion": "pissenlit", "roses": "rose",
        "sunflowers": "tournesol", "tulips": "tulipe"}

def carre_128(chemin):
    img = cv2.imread(chemin)
    if img is None:
        return None
    h, w = img.shape[:2]
    c = min(h, w)                          # recadrage carre centre
    img = img[(h - c) // 2:(h - c) // 2 + c, (w - c) // 2:(w - c) // 2 + c]
    return cv2.resize(img, (TAILLE, TAILLE), interpolation=cv2.INTER_AREA)

# 1. Telechargement (environ 220 Mo, une seule fois)
if not os.path.isdir("flower_photos"):
    if not os.path.isfile("flower_photos.tgz"):
        print("Telechargement de flower_photos.tgz ...")
        urllib.request.urlretrieve(URL, "flower_photos.tgz")
    print("Decompression ...")
    with tarfile.open("flower_photos.tgz") as t:
        if hasattr(tarfile, "data_filter"):   # Python recent : extraction securisee
            t.extractall(".", filter="data")
        else:
            t.extractall(".")

# 2. dataset_fleurs/train/<classe> et dataset_fleurs/test/<classe>
#    + quelques photos pour la carte
for d in ("dataset_fleurs", "photos_carte"):   # repart de zero
    shutil.rmtree(d, ignore_errors=True)
os.makedirs("photos_carte")
random.seed(0)           # meme tirage pour tout le monde
for en, fr in NOMS.items():
    fichiers = sorted(os.listdir(os.path.join("flower_photos", en)))
    random.shuffle(fichiers)
    n_test = int(N_PAR_CLASSE * PART_TEST)
    for i, nom in enumerate(fichiers[:N_PAR_CLASSE]):
        groupe = "test" if i < n_test else "train"
        dossier = os.path.join("dataset_fleurs", groupe, fr)
        os.makedirs(dossier, exist_ok=True)
        img = carre_128(os.path.join("flower_photos", en, nom))
        if img is not None:
            cv2.imwrite(os.path.join(dossier, "%s_%03d.jpg" % (fr, i)), img)
    # photos jamais vues par eIQ Portal, pour le test sur la carte
    for j, nom in enumerate(fichiers[N_PAR_CLASSE:N_PAR_CLASSE + N_CARTE]):
        img = carre_128(os.path.join("flower_photos", en, nom))
        if img is not None:
            cv2.imwrite(os.path.join("photos_carte", "%s_%d.jpg" % (fr, j + 1)), img)
    print("%-11s : %d train, %d test" % (fr, N_PAR_CLASSE - n_test, n_test))
print("Termine : importer le dossier dataset_fleurs dans eIQ Portal")