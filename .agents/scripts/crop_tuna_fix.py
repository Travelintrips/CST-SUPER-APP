import fitz, os
src = "attached_assets/PT._CST_International_Trading_Divison_Product_1784024981949.pdf"
outdir = ".agents/outputs/cst-pdf/crops"
doc = fitz.open(src)
PW, PH = 842.0, 595.0
page = doc[4]  # page 5

jobs = [
    ("tuna_loin_tile", (0.02,0.20,0.245,0.48)),
    ("tuna_steak_tile", (0.255,0.20,0.475,0.48)),
    ("tuna_saku_tile", (0.485,0.20,0.665,0.48)),
]
for name, box in jobs:
    rect = fitz.Rect(box[0]*PW, box[1]*PH, box[2]*PW, box[3]*PH)
    pix = page.get_pixmap(matrix=fitz.Matrix(3,3), clip=rect)
    pix.save(f"{outdir}/{name}.png")
    print(name, pix.width, pix.height)
