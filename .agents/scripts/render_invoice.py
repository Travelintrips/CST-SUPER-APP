from pathlib import Path
import fitz

pdf_path = Path('attached_assets/sc_5_agust_26_1788605873853.pdf')
out_dir = Path('.agents/outputs/invoice-render')
out_dir.mkdir(parents=True, exist_ok=True)
doc = fitz.open(pdf_path)
print('pages', doc.page_count)
print('metadata', doc.metadata)
for i, page in enumerate(doc):
    print(f'page {i+1} rect={page.rect} images={len(page.get_images(full=True))}')
    text = page.get_text('text')
    print(f'page {i+1} text_chars={len(text)} text_preview={text[:500]!r}')
    pix = page.get_pixmap(matrix=fitz.Matrix(2.5, 2.5), alpha=False)
    out = out_dir / f'page-{i+1}.png'
    pix.save(out)
    print('rendered', out)
