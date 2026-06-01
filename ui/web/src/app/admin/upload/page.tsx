import { UploadForm } from './UploadForm';

export default function AdminUploadPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="font-serif text-3xl">Excel Stock Upload</h1>
      <p className="text-sm text-brand-700">
        Upload an .xlsx or .csv file. Two modes:
      </p>
      <ul className="text-sm text-brand-700 list-disc pl-5 space-y-1">
        <li><b>Add new only</b> — adds rows whose <span className="font-mono">stone_id</span> is not already in the system. Existing rows are left untouched (counted as <i>skipped</i>).</li>
        <li><b>Edit all</b> — updates existing rows and adds new ones (full upsert).</li>
      </ul>
      <p className="text-xs text-brand-700">
        Both actions require your admin password before applying. Recognized columns include
        <span className="font-mono"> stone_id, shape, carat, color, clarity, cut, polish, sym, fl, lab,
        report_no, video, image, measurement, table_pct, depth_pct, rap, discounts_pct, ppc, p_pcs,
        location, status, shade, milky, eyeclean, luster, growth_type, inscri</span> and many aliases.
        Header names are case-insensitive and tolerant of spaces / underscores / dashes.
      </p>
      <UploadForm />
    </div>
  );
}
