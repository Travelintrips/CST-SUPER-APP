import fitz
from pathlib import Path
src=Path('attached_assets/FK_0010610202093000_0850092743039000_1001180001491200058624202_1788708426918.pdf')
out=Path('.agents/outputs/invoice_pdf_pages'); out.mkdir(parents=True, exist_ok=True)
doc=fitz.open(src)
print('pages', doc.page_count)
for i,page in enumerate(doc):
    print('page', i+1, 'text:', page.get_text()[:500].replace('\n',' | '))
    pix=page.get_pixmap(matrix=fitz.Matrix(2,2), alpha=False)
    path=out/f'page-{i+1}.png'; pix.save(path); print(path)
