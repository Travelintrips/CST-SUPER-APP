from pathlib import Path

import fitz


source = Path("attached_assets/sc_5_agust_26_1788615010004.pdf")
output_dir = Path(".agents/outputs/sc_5_agust_26_rendered")
output_dir.mkdir(parents=True, exist_ok=True)

document = fitz.open(source)
for page_index, page in enumerate(document):
    pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    output_path = output_dir / f"page-{page_index + 1}.png"
    pixmap.save(output_path)
    print(f"rendered page {page_index + 1}: {output_path}")