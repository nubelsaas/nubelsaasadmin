import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { randomUUID } from 'crypto';

// Requires a public Supabase Storage bucket named 'empresa-logos'.
// Create it in: Supabase Dashboard → Storage → New bucket → Name: empresa-logos → Public: true

export async function POST(req: NextRequest) {
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 });

  const ext  = file.name.split('.').pop() ?? 'png';
  const path = `${randomUUID()}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const db = createAdminClient();

  const { error } = await db.storage
    .from('empresa-logos')
    .upload(path, buffer, { contentType: file.type, upsert: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: { publicUrl } } = db.storage.from('empresa-logos').getPublicUrl(path);
  return NextResponse.json({ url: publicUrl });
}
