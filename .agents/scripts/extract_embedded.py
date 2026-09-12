import fitz
import os

src = "attached_assets/PT._CST_International_Trading_Divison_Product_1784024981949.pdf"
outdir = ".agents/outputs/cst-pdf"
os.makedirs(outdir, exist_ok=True)

doc = fitz.open(src)
for i, page in enumerate(doc):
    imgs = page.get_images(full=True)
    for j, img in enumerate(imgs):
        xref = img[0]
        base = doc.extract_image(xref)
        ext = base["ext"]
        data = base["image"]
        fname = f"{outdir}/embedded_p{i+1:02d}_{j}.{ext}"
        with open(fname, "wb") as f:
            f.write(data)
        print(fname, len(data), base.get("width"), base.get("height"))
