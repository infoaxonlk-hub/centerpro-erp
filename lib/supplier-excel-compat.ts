/**
 * ExcelJS expects the SpreadsheetML namespace as the document's default namespace.
 * Some valid XLSX generators emit x:sst/x:worksheet/x:styleSheet instead.
 * Normalize only SpreadsheetML-prefixed elements in a temporary in-memory copy.
 * The source file stays unchanged, so import-token hashing remains stable.
 */
const spreadsheetNs = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

export async function loadCompatibleSupplierWorkbook(originalBytes: ArrayBuffer) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(new Uint8Array(originalBytes) as never);
    return workbook;
  } catch (firstError) {
    const description = firstError instanceof Error ? firstError.message : "";
    // Do not reprocess corrupt files or unrelated XLSX errors.
    if (!description.includes("Unexpected xml node in parseOpen") &&
        !description.includes("Cannot set properties of undefined (setting 'sheetNo')")) throw firstError;
  }

  const JSZip = (await import("jszip")).default;
  const archive = await JSZip.loadAsync(originalBytes);
  let modified = 0;
  for (const name of Object.keys(archive.files)) {
    if (!/^xl\/(?:workbook\.xml|sharedStrings\.xml|styles\.xml|worksheets\/sheet[0-9]+\.xml)$/.test(name)) continue;
    const file = archive.files[name];
    if (file.dir) continue;
    const xml = await file.async("string");
    if (name === "xl/workbook.xml") {
      // Other writers use ns1:id instead of r:id on <sheet> elements.
      // ExcelJS requires the canonical r:id attribute for worksheet mapping.
      const relNamespace = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
      const prefixes = ["ns1", "ns0", "ns2"];
      let normalizedWorkbook = xml;
      for (const prefix of prefixes) {
        const declaration = 'xmlns:' + prefix + '="' + relNamespace + '"';
        if (!normalizedWorkbook.includes(declaration)) continue;
        normalizedWorkbook = normalizedWorkbook
          .replace(declaration, 'xmlns:r="' + relNamespace + '"')
          .replace(new RegExp('(\\s)' + prefix + ':id=', "g"), '$1r:id=');
      }
      if (normalizedWorkbook !== xml) {
        archive.file(name, normalizedWorkbook);
        modified += 1;
      }
      continue;
    }
    const namespaceDeclaration = 'xmlns:x="' + spreadsheetNs + '"';
    if (!xml.includes(namespaceDeclaration) || !/<\/?x:[A-Za-z]/.test(xml)) continue;
    // Replace element prefixes, not text/values, and preserve other namespaces
    // such as xml:space and relationship attributes.
    const normalized = xml
      .replace(namespaceDeclaration, 'xmlns="' + spreadsheetNs + '"')
      .replace(/<(\/?)(x):([a-zA-Z][\w.-]*)/g, "<$1$3");
    archive.file(name, normalized);
    modified += 1;
  }
  if (modified === 0) throw new Error("This Excel workbook uses unsupported XML markup. Please export a fresh template.");
  const buffer = await archive.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: {level: 4},
  });
  const normalizedWorkbook = new ExcelJS.Workbook();
  await normalizedWorkbook.xlsx.load(buffer as never);
  return normalizedWorkbook;
}
