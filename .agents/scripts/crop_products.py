import fitz, os

src = "attached_assets/PT._CST_International_Trading_Divison_Product_1784024981949.pdf"
outdir = ".agents/outputs/cst-pdf/crops"
os.makedirs(outdir, exist_ok=True)
doc = fitz.open(src)
PW, PH = 842.0, 595.0

def frac_to_rect(x0,y0,x1,y1):
    return fitz.Rect(x0*PW, y0*PH, x1*PW, y1*PH)

# page_index (0-based), list of (name, fractional box)
jobs = {
    2: [  # page 3 = coffee
        ("coffee_hero", (0.01,0.20,0.30,0.86)),
    ],
    3: [  # page 4 = cashew R320 + R240
        ("cashew_r320_tile", (0.345,0.195,0.505,0.345)),
        ("cashew_r240_tile", (0.505,0.195,0.655,0.345)),
        ("cashew_hero_shared", (0.01,0.17,0.335,0.62)),
    ],
    4: [  # page 5 = tuna loin/steak/saku
        ("tuna_loin_tile", (0.02,0.19,0.30,0.47)),
        ("tuna_steak_tile", (0.30,0.19,0.58,0.47)),
        ("tuna_saku_tile", (0.58,0.19,0.86,0.47)),
    ],
    5: [  # page 6 = palm acid oil
        ("palm_acid_oil_hero", (0.02,0.16,0.34,0.37)),
        ("palm_acid_oil_overview", (0.02,0.37,0.28,0.63)),
        ("palm_acid_oil_apps", (0.65,0.32,0.97,0.63)),
    ],
    6: [  # page 7 = fresh pineapple MD2 / Honey
        ("pineapple_md2_tile", (0.02,0.19,0.31,0.47)),
        ("pineapple_honey_tile", (0.32,0.19,0.60,0.47)),
        ("pineapple_shared_basket", (0.20,0.49,0.46,0.87)),
    ],
    7: [  # page 8 = canned pineapple slices/chunks
        ("canned_slices_tile", (0.04,0.42,0.29,0.63)),
        ("canned_chunks_tile", (0.30,0.42,0.55,0.63)),
        ("canned_shared_cans", (0.30,0.15,0.63,0.35)),
    ],
}

for page_idx, items in jobs.items():
    page = doc[page_idx]
    for name, box in items:
        rect = frac_to_rect(*box)
        pix = page.get_pixmap(matrix=fitz.Matrix(3,3), clip=rect)
        path = f"{outdir}/{name}.png"
        pix.save(path)
        print(path, pix.width, pix.height)
