"""Shared category simplification logic used across multiple generators."""


def simplify_category(shape, carat, color, clarity):
    """
    Derive category_simple string for a diamond.

    Args:
        shape: str (e.g. "Round", "Princess")
        carat: float
        color: str (e.g. "D", "E", "G")
        clarity: str (e.g. "IF", "VVS1", "VS2")

    Returns:
        str in format "Shape | Carat Bucket | Color Group | Clarity Group"
    """
    color = str(color).strip().upper()
    clarity = str(clarity).strip().upper()
    shape = str(shape).strip().title()
    carat = float(carat)

    if color in ["D", "E", "F"]:
        color_group = "DEF"
    elif color in ["G", "H"]:
        color_group = "GH"
    else:
        color_group = "IJK"

    if clarity in ["IF", "VVS1", "VVS2"]:
        clarity_group = "VVS+"
    elif clarity in ["VS1", "VS2"]:
        clarity_group = "VS"
    else:
        clarity_group = "SI"

    if carat < 0.50:
        bucket = "0.25-0.49"
    elif carat < 1.00:
        bucket = "0.50-0.99"
    elif carat < 1.50:
        bucket = "1.00-1.49"
    elif carat < 2.00:
        bucket = "1.50-1.99"
    elif carat < 3.00:
        bucket = "2.00-2.99"
    else:
        bucket = "3.00+"

    return f"{shape} | {bucket} | {color_group} | {clarity_group}"
