import fitz, os
src = "attached_assets/PT._CST_International_Trading_Divison_Product_1784024981949.pdf"
outdir = ".agents/outputs/cst-pdf/crops"
doc = fitz.open(src)
PW, PH = 842.0, 595.0

def crop(page_idx, name, box):
    page = doc[page_idx]
    rect = fitz.Rect(box[0]*PW, box[1]*PH, box[2]*PW, box[3]*PH)
    pix = page.get_pixmap(matrix=fitz.Matrix(3,3), clip=rect)
    pix.save(f"{outdir}/{name}.png")
    print(name, pix.width, pix.height)

crop(5, "palm_acid_oil_hero", (0.29,0.14,0.66,0.40))
crop(6, "pineapple_md2_tile", (0.02,0.235,0.30,0.48))
crop(6, "pineapple_honey_tile", (0.32,0.235,0.585,0.42))
