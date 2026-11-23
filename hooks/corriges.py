"""Retire du menu les pages exclues du site (corrigés non publics).

Les corrigés cachés sont listés dans `exclude_docs` (mkdocs.yml). Sans ce hook,
leur entrée resterait dans le menu et pointerait vers une page inexistante.
"""


def _est_exclue(item):
    fichier = getattr(item, "file", None)
    if fichier is None:
        return False
    inclusion = getattr(fichier, "inclusion", None)
    return inclusion is not None and inclusion.is_excluded()


def _filtrer(items):
    garder = []
    for item in items:
        if _est_exclue(item):
            continue
        enfants = getattr(item, "children", None)
        if enfants:
            item.children = _filtrer(enfants)
        garder.append(item)
    return garder


def on_nav(nav, config, files):
    nav.items = _filtrer(nav.items)
    nav.pages = [p for p in nav.pages if not _est_exclue(p)]
    return nav
