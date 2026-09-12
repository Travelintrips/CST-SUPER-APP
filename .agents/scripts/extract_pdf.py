import fitz
import os

src = "attached_assets/PT._CST_International_Trading_Divison_Product_1784024981949.pdf"
outdir = ".agents/outputs/cst-pdf"
os.makedirs(outdir, exist_ok=True)

doc = fitz.open(src)
print("page_count:", doc.page_count)

for i, page in enumerate(doc):
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
    pix.save(f"{outdir}/page_{i+1:02d}.png")
    text = page.get_text()
    print(f"--- page {i+1} text len={len(text)} ---")
    if text.strip():
        print(text[:500])
    imgs = page.get_images(full=True)
    print(f"page {i+1} embedded images: {len(imgs)}")

print("DONE render")
