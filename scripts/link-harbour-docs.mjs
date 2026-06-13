import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, "")];
    }),
);

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const projectId = "eb7e1581-6007-426f-8efa-751e50335495";
const downloads = "/Users/amitbhattacharya/Downloads";

const files = [
  ["Harbour_Centre_Sponsor_Summary.pdf", "Sponsor_Summary.pdf", "application/pdf"],
  ["Harbour_Centre_Market_Study.pdf", "Market_Study.pdf", "application/pdf"],
  ["Harbour_Centre_Broker_Opinion.pdf", "Broker_Opinion.pdf", "application/pdf"],
  ["Harbour_Centre_Lender_Term_Sheet.pdf", "Lender_Term_Sheet.pdf", "application/pdf"],
  [
    "Harbour_Centre_Construction_Budget.xlsx",
    "Construction_Budget.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  [
    "Harbour_Centre_Rent_Roll.xlsx",
    "Rent_Roll.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
];

const { data: project, error: projectError } = await supabase
  .from("projects")
  .select("owner_id")
  .eq("id", projectId)
  .single();
if (projectError) throw projectError;

const ownerId = project.owner_id;

for (const [name, fileName, contentType] of files) {
  const storagePath = `${ownerId}/demo/harbour-centre/${fileName}`;
  const localPath = path.join(downloads, name);
  const body = fs.readFileSync(localPath);
  const upload = await supabase.storage.from("documents").upload(storagePath, body, {
    upsert: true,
    contentType,
  });
  if (upload.error) throw new Error(`${name}: ${upload.error.message}`);

  const update = await supabase
    .from("documents")
    .update({
      storage_path: storagePath,
      file_type: contentType,
      size_bytes: body.length,
      status: "uploaded",
      extraction_error: null,
    })
    .eq("project_id", projectId)
    .eq("name", name);
  if (update.error) throw new Error(`${name}: ${update.error.message}`);
  console.log(`linked ${name} -> ${storagePath}`);
}

const { data: docs, error } = await supabase
  .from("documents")
  .select("name,storage_path,file_type,size_bytes")
  .eq("project_id", projectId)
  .order("name");
if (error) throw error;

console.log(`updated ${docs.length} document rows`);
