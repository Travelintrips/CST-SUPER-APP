import pg from 'pg';
const { Client } = pg;
const APP_ENV = process.env.APP_ENV;
const dbUrl = process.env.SUPABASE_DATABASE_URL;
if (APP_ENV !== 'development') throw new Error(`Refusing non-development APP_ENV: ${APP_ENV}`);
if (!dbUrl) throw new Error('SUPABASE_DATABASE_URL is missing');
if (dbUrl.includes('nzdweipzckfszczzqtuw')) throw new Error('Refusing known production project');
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
const q = (sql, params=[]) => client.query(sql, params);
const now = () => new Date();

async function setupOnce() {
  await q('BEGIN');
  try {
    await q('SELECT pg_advisory_xact_lock($1, $2)', [20260828, 3]);

    const companyRows = (await q(`
      SELECT id, COALESCE(NULLIF(company_name,''), name) AS display_name
      FROM public.companies
      WHERE id = 3
      FOR UPDATE
    `)).rows;
    const divaNameRows = (await q(`
      SELECT id, COALESCE(NULLIF(company_name,''), name) AS display_name
      FROM public.companies
      WHERE lower(COALESCE(NULLIF(company_name,''), name)) = lower($1)
    `, ['PT Diva Servis'])).rows;
    if (companyRows.length !== 1 || companyRows[0].display_name !== 'PT Diva Servis' || divaNameRows.length !== 1 || divaNameRows[0].id !== 3) {
      throw new Error(`Canonical company guard failed: id3=${JSON.stringify(companyRows)}, nameMatches=${JSON.stringify(divaNameRows)}`);
    }
    const buyerCompany = (await q(`SELECT id FROM public.companies WHERE id=1 AND is_active=true`)).rows;
    if (buyerCompany.length !== 1) throw new Error('Tenant buyer company 1 is not an active canonical company');

    const linkedSuppliers = (await q(`
      SELECT id,name,company_id,status,is_active,is_verified,marketplace_status,public_slug,service_type
      FROM public.suppliers WHERE company_id=3 ORDER BY id FOR UPDATE
    `)).rows;
    if (linkedSuppliers.length > 1) throw new Error(`Duplicate supplier rows already linked to company 3: ${linkedSuppliers.length}`);
    const sameNameSuppliers = (await q(`
      SELECT id,name,company_id,status,is_active,is_verified,marketplace_status,public_slug,service_type
      FROM public.suppliers WHERE lower(name)=lower($1) ORDER BY id FOR UPDATE
    `, ['PT Diva Servis'])).rows;
    if (linkedSuppliers.length === 0 && sameNameSuppliers.length > 0) {
      throw new Error(`Unlinked supplier with canonical name exists; refusing duplicate: ${JSON.stringify(sameNameSuppliers)}`);
    }

    let supplier = linkedSuppliers[0];
    let supplierCreated = false;
    if (!supplier) {
      const slugTaken = (await q(`SELECT id FROM public.suppliers WHERE public_slug=$1`, ['pt-diva-servis-3'])).rows;
      if (slugTaken.length > 0) throw new Error(`Canonical public slug is already used by supplier ${slugTaken[0].id}`);
      supplier = (await q(`
        INSERT INTO public.suppliers
          (company_id,name,service_type,is_active,status,is_verified,marketplace_status,public_slug,logo,sort_order,updated_at)
        VALUES (3,'PT Diva Servis','trucking',false,'pending',false,'draft','pt-diva-servis-3','🚛',999,NOW())
        RETURNING id,name,company_id,status,is_active,is_verified,marketplace_status,public_slug,service_type
      `)).rows[0];
      supplierCreated = true;
    } else {
      await q(`UPDATE public.suppliers SET name='PT Diva Servis', company_id=3, service_type='trucking', public_slug=COALESCE(public_slug,'pt-diva-servis-3'), updated_at=NOW() WHERE id=$1`, [supplier.id]);
      supplier = (await q(`SELECT id,name,company_id,status,is_active,is_verified,marketplace_status,public_slug,service_type FROM public.suppliers WHERE id=$1 FOR UPDATE`, [supplier.id])).rows[0];
    }

    const actor = 'dev-canonical-vendor-setup';
    if (!supplier.is_verified) {
      await q(`UPDATE public.suppliers SET is_verified=true, verified_at=NOW(), verified_by=$2, updated_at=NOW() WHERE id=$1`, [supplier.id, actor]);
    }
    if (supplier.status !== 'active' || supplier.is_active !== true) {
      const previousStatus = supplier.status;
      await q(`
        UPDATE public.suppliers
        SET status='active', is_active=true, status_reason='Development canonical vendor setup',
            status_changed_at=NOW(), status_changed_by=$2, updated_at=NOW()
        WHERE id=$1
      `, [supplier.id, actor]);
      await q(`
        INSERT INTO public.supplier_status_history
          (supplier_id,previous_status,new_status,reason,actor_user_id,company_id,request_id,created_at)
        VALUES ($1,$2,'active','Development canonical vendor setup',$3,3,'dev-canonical-vendor-setup',NOW())
      `, [supplier.id, previousStatus, actor]);
    }
    const currentSupplier = (await q(`SELECT id,name,company_id,status,is_active,is_verified,marketplace_status,public_slug,service_type FROM public.suppliers WHERE id=$1`, [supplier.id])).rows[0];
    if (currentSupplier.status !== 'active' || currentSupplier.is_active !== true || currentSupplier.is_verified !== true) throw new Error(`Supplier lifecycle did not reach active+verified: ${JSON.stringify(currentSupplier)}`);
    if (currentSupplier.marketplace_status !== 'published') {
      await q(`UPDATE public.suppliers SET marketplace_status='published', marketplace_published_at=NOW(), marketplace_published_by=$2, updated_at=NOW() WHERE id=$1`, [supplier.id, actor]);
    }

    const assignments = (await q(`SELECT id,vendor_id,company_id FROM public.vendor_company_assignments WHERE vendor_id=$1 AND company_id=1 FOR UPDATE`, [supplier.id])).rows;
    if (assignments.length > 1) throw new Error(`Duplicate tenant assignment rows: ${assignments.length}`);
    let assignmentCreated = false;
    if (assignments.length === 0) {
      await q(`INSERT INTO public.vendor_company_assignments (vendor_id,company_id) VALUES ($1,1)`, [supplier.id]);
      assignmentCreated = true;
    }

    const templateRows = (await q(`SELECT id,service_type,label,emoji,version,is_active,fields,required_documents,checklist,conditional_rules,validation_rules,media_assets FROM public.service_templates WHERE id=2 AND service_type='trucking' FOR UPDATE`)).rows;
    if (templateRows.length !== 1 || !templateRows[0].is_active) throw new Error(`Canonical trucking template guard failed: ${JSON.stringify(templateRows)}`);
    const tpl = templateRows[0];
    const snapshot = {
      category: tpl.service_type,
      serviceType: tpl.service_type,
      label: tpl.label,
      emoji: tpl.emoji,
      version: tpl.version,
      fields: tpl.fields,
      requiredDocuments: tpl.required_documents,
      checklist: tpl.checklist,
      conditionalRules: tpl.conditional_rules,
      validationRules: tpl.validation_rules,
    };

    const logicalCatalog = (await q(`
      SELECT id,vendor_id,template_kind,category_key,service_type,template_id,name,price_sell,is_active,is_published,status
      FROM public.vendor_catalog_items
      WHERE vendor_id=$1 AND template_kind='service' AND (template_id='2' OR service_type='trucking')
      ORDER BY id FOR UPDATE
    `, [supplier.id])).rows;
    if (logicalCatalog.length > 1) throw new Error(`Duplicate logical trucking catalog rows: ${logicalCatalog.length}`);
    let catalog = logicalCatalog[0];
    let catalogCreated = false;
    if (!catalog) {
      catalog = (await q(`
        INSERT INTO public.vendor_catalog_items
          (vendor_id,vendor_name,type,name,description,unit,price_base,markup_pct,price_sell,currency,
           kategori,category_key,service_type,template_kind,template_id,template_version,template_snapshot,spec_values,
           stock_status,moq,lead_time,documents,status,is_published,is_active,published_at,sort_order,media_assets)
        VALUES
          ($1,'PT Diva Servis','service','Jasa Trucking — PT Diva Servis',
           'Layanan trucking darat untuk kebutuhan pengiriman; harga melalui permintaan penawaran (RFQ).',
           'trip',0,0,NULL,'IDR','trucking','trucking','trucking','service','2',$2,$3::jsonb,'{}'::jsonb,
           'available',NULL,NULL,NULL,'published',true,true,NOW(),999,'[]'::jsonb)
        RETURNING id,vendor_id,template_kind,category_key,service_type,template_id,name,price_sell,is_active,is_published,status
      `, [supplier.id, tpl.version, JSON.stringify(snapshot)])).rows[0];
      catalogCreated = true;
    } else {
      catalog = (await q(`
        UPDATE public.vendor_catalog_items SET
          vendor_id=$1,vendor_name='PT Diva Servis',type='service',name='Jasa Trucking — PT Diva Servis',
          description='Layanan trucking darat untuk kebutuhan pengiriman; harga melalui permintaan penawaran (RFQ).',
          unit='trip',price_base=0,markup_pct=0,price_sell=NULL,currency='IDR',kategori='trucking',category_key='trucking',service_type='trucking',
          template_kind='service',template_id='2',template_version=$2,template_snapshot=$3::jsonb,spec_values=COALESCE(spec_values,'{}'::jsonb),
          stock_status='available',status='published',is_published=true,is_active=true,published_at=COALESCE(published_at,NOW()),updated_at=NOW()
        WHERE id=$4
        RETURNING id,vendor_id,template_kind,category_key,service_type,template_id,name,price_sell,is_active,is_published,status
      `, [supplier.id, tpl.version, JSON.stringify(snapshot), catalog.id])).rows[0];
    }

    await q('COMMIT');
    return { supplierId: supplier.id, supplierCreated, assignmentCreated, catalogId: catalog.id, catalogCreated };
  } catch (err) {
    await q('ROLLBACK');
    throw err;
  }
}

await client.connect();
try {
  const first = await setupOnce();
  const second = await setupOnce();
  const proof = {
    company: (await q(`SELECT COUNT(*)::int AS count, COUNT(*) FILTER (WHERE id=3 AND COALESCE(NULLIF(company_name,''),name)='PT Diva Servis')::int AS canonical FROM public.companies WHERE lower(COALESCE(NULLIF(company_name,''),name))=lower('PT Diva Servis')`)).rows[0],
    supplier: (await q(`SELECT id,name,company_id,status,is_active,is_verified,marketplace_status,public_slug,service_type FROM public.suppliers WHERE company_id=3`)).rows,
    assignment: (await q(`SELECT vca.id,vca.vendor_id,vca.company_id FROM public.vendor_company_assignments vca JOIN public.suppliers s ON s.id=vca.vendor_id WHERE s.company_id=3`)).rows,
    template: (await q(`SELECT id,service_type,version,is_active FROM public.service_templates WHERE id=2`)).rows,
    catalog: (await q(`SELECT id,vendor_id,vendor_name,type,template_kind,category_key,service_type,template_id,template_version,name,price_sell,is_active,is_published,status FROM public.vendor_catalog_items WHERE vendor_id=(SELECT id FROM public.suppliers WHERE company_id=3)`)).rows,
    duplicateSupplierRows: Number((await q(`SELECT COUNT(*) FROM public.suppliers WHERE company_id=3`)).rows[0].count),
    duplicateTenantAssignmentRows: Number((await q(`SELECT COUNT(*) FROM public.vendor_company_assignments WHERE vendor_id=(SELECT id FROM public.suppliers WHERE company_id=3) AND company_id=1`)).rows[0].count),
    duplicateTruckingCatalogRows: Number((await q(`SELECT COUNT(*) FROM public.vendor_catalog_items WHERE vendor_id=(SELECT id FROM public.suppliers WHERE company_id=3) AND template_kind='service' AND (template_id='2' OR service_type='trucking')`)).rows[0].count),
  };
  console.log(JSON.stringify({first,second,proof}, null, 2));
} finally { await client.end(); }
