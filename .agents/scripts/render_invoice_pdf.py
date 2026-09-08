import fitz
from pathlib import Path

src = Path("attached_assets/inv_sc_jul_26_1788879461298.pdf")
out = Path(".agents/outputs/inv_sc_jul_26")
out.mkdir(parents=True, exist_ok=True)
doc = fitz.open(src)
print("pages", doc.page_count)
for i, page in enumerate(doc):
    print("page", i + 1, "text:", page.get_text()[:800].replace("\n", " | "))
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    path = out / f"page-{i + 1}.png"
    pix.save(path)
    print(path)
