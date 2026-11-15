/*
 * Pemeriksa Aturan Emas: pemeriksaan deterministik (tanpa AI, tanpa jaringan) atas teks draf keluar
 * atau pesan masuk dari supplier. Heuristik berbasis kata kunci; BUKAN pengganti keputusan Direktur.
 * `ok: true` hanya berarti tidak ada pelanggaran yang terdeteksi, bukan persetujuan.
 * Repo ini publik: hanya aturan umum yang sudah menjadi SOP; tidak ada data supplier atau angka rahasia.
 */
export type Direction = "draft" | "incoming";
export type Severity = "blokir" | "peringatan";
export type Finding = { id: string; severity: Severity; message: string; evidence: string };
export type CheckResult = { ok: boolean; blocking: number; findings: Finding[] };
export type CheckOptions = { direction: Direction; requireDraftMarker?: boolean };

const MAX_FINDINGS = 20;
const MAX_PER_RULE = 3;
const MAX_EVIDENCE = 140;

const NEGATION = /\b(?:not|no|never|cannot|can't|cant|won't|unable|decline\w*|reject\w*|refus\w*|without|neither|nor|tidak|tak|tolak|menolak|ditolak|tanpa|bukan)\b/i;
const ACCEPTING = /\b(?:we (?:accept|agree|will pay|can pay|are willing to pay|shall pay)|kami (?:setuju|bersedia|akan membayar))\b/i;

const UPFRONT = [
  /\b(?:prepay\w*|pre-pay\w*|advance payment|payment in advance|pay(?:ing)? in advance|paid in advance|down ?payment|deposit|t\/t in advance|tt in advance|uang muka|bayar di muka|pembayaran di muka|upfront|full payment before)\b/i,
  /\b(?:pay|payment)\w* (?:\d{1,3}% )?before (?:shipment|shipping|delivery|dispatch)\b/i,
  /\b\d{1,3}% (?:before (?:shipment|shipping|delivery|dispatch)|t\/t|tt|advance|upfront|deposit)\b/i,
  /\bDP\b/,
];
const SAMPLE = /\b(?:samples?|sampel|contoh)\b/i;
const SAMPLE_CHARGE = /\b(?:fee|fees|charge\w*|cost|costs|pay|paid|payment|price|USD|EUR|US\$|biaya|bayar|berbayar)\b|\$/i;
const SAMPLE_FREE = /\b(?:free|gratis|complimentary|at your (?:own )?(?:cost|expense)|supplier'?s? (?:cost|expense)|by (?:the )?supplier|ditanggung supplier|dibebankan ke supplier)\b/i;
const COMMITMENT = /\b(?:we (?:will|shall|are going to|would like to) (?:place|confirm|issue|proceed with)(?: an?| the)? (?:order|purchase|PO)|we (?:hereby )?(?:confirm|accept|agree to)(?: the)? (?:order|purchase|price|quotation|proforma|PI|MOQ|terms)|purchase order (?:is )?(?:attached|issued|enclosed)|we commit|committed (?:volume|order|to)|exclusive(?:ly)? distribut\w*|kami (?:akan )?memesan|kami konfirmasi pesanan|kami setuju (?:dengan )?(?:harga|pesanan|MOQ)|kami (?:berkomitmen|menyetujui))\b/i;
const REG_CLAIM = [
  /\b(?:BPOM|NIE|halal|MUI|BPJPH)\b.{0,40}\b(?:approved|registered|certified|obtained|valid|disetujui|terdaftar|bersertifikat|memiliki)\b/i,
  /\b(?:approved|registered|certified)\b.{0,20}\b(?:BPOM|halal)\b/i,
  /\bHS\s*code\b\W{0,3}\d{4}/i,
];
const INTERNAL = /\b(?:aturan emas|golden rules?|playbook|internal budget|our (?:internal )?budget|anggaran internal|budget internal|strategi internal|internal strategy)\b/i;
const NO_HALAL = /\b(?:no halal|not halal|(?:do(?:es)?n'?t|do(?:es)? not|never) (?:have|hold|plan)\b.{0,30}\bhalal|belum (?:punya|ada|memiliki) halal|tidak (?:punya|ada|memiliki) halal)\b/i;

const RE_PAYMENT_MENTION = /\b(?:payment|pay|invoice|proforma|pro forma|pembayaran|bayar)\b/i;
const RE_PAYMENT_OK = /\bL\/?C\b|letter of credit|trade assurance|at sight/i;
const RE_SHIPPING = /\b(?:shipping|shipment|freight|courier|DHL|FedEx|delivery|pengiriman|ongkir)\b/i;
const RE_COLLECT = /\bcollect\b/i;
const RE_ORDER = /\b(?:order|proforma|pro forma|purchase|quotation|pesan\w*|pemesanan)\b/i;
const RE_DOCS = /\bhalal\b|\bLoA\b|letter of authori[sz]ation|\bCFS\b|certificate of free sale/i;
const RE_MARKER = /DRAFT\s*[-–—]\s*belum dikirim/i;
const RE_UNVERIFIED = /\[PERLU DIBUKTIKAN\]/i;

const clip = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > MAX_EVIDENCE ? `${t.slice(0, MAX_EVIDENCE - 1)}…` : t;
};
const anyMatch = (res: RegExp[], s: string) => res.some((re) => re.test(s));
const rejects = (s: string) => NEGATION.test(s) && !ACCEPTING.test(s);

export function checkGoldenRules(text: string, opts: CheckOptions): CheckResult {
  const findings: Finding[] = [];
  const perRule = new Map<string, number>();
  const add = (f: Finding) => {
    const n = perRule.get(f.id) ?? 0;
    if (n >= MAX_PER_RULE || findings.length >= MAX_FINDINGS) return;
    perRule.set(f.id, n + 1);
    findings.push(f);
  };
  const incoming = opts.direction === "incoming";
  const sentences = text.split(/(?<=[.!?;])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

  for (const s of sentences) {
    if (anyMatch(UPFRONT, s) && !rejects(s)) {
      add(incoming
        ? { id: "pembayaran_di_muka", severity: "peringatan", message: "Supplier meminta pembayaran di muka. Aturan Emas: tolak DP/prepayment untuk order pertama; tawarkan L/C at sight BNI atau Alibaba Trade Assurance.", evidence: clip(s) }
        : { id: "pembayaran_di_muka", severity: "blokir", message: "Draf menyebut pembayaran di muka (DP/prepayment). Aturan Emas: pembayaran hanya L/C at sight BNI atau Alibaba Trade Assurance.", evidence: clip(s) });
    }
    if (SAMPLE.test(s) && SAMPLE_CHARGE.test(s) && !SAMPLE_FREE.test(s) && !NEGATION.test(s)) {
      add(incoming
        ? { id: "sampel_berbayar", severity: "peringatan", message: "Supplier menyebut biaya sampel. Aturan Emas: sampel gratis dengan ongkir ditanggung supplier.", evidence: clip(s) }
        : { id: "sampel_berbayar", severity: "blokir", message: "Draf menyiratkan sampel berbayar. Aturan Emas: sampel gratis dengan ongkir ditanggung supplier.", evidence: clip(s) });
    }
    if (incoming && NO_HALAL.test(s)) {
      add({ id: "halal_tidak_ada", severity: "peringatan", message: "Supplier menyatakan belum punya halal. Halal wajib di Indonesia: tahan PI dan sampel sampai dokumen ada.", evidence: clip(s) });
    }
    if (incoming) continue;
    const m = COMMITMENT.exec(s);
    if (m && !NEGATION.test(s.slice(0, m.index))) {
      add({ id: "komitmen_pembelian", severity: "blokir", message: "Draf berisi komitmen pembelian, persetujuan harga/MOQ/syarat, atau eksklusivitas. Hanya Direktur yang memutuskan.", evidence: clip(s) });
    }
    if (INTERNAL.test(s)) {
      add({ id: "kebocoran_internal", severity: "blokir", message: "Draf menyebut aturan, anggaran, atau strategi internal kepada pihak luar.", evidence: clip(s) });
    }
    if (anyMatch(REG_CLAIM, s) && !RE_UNVERIFIED.test(text)) {
      add({ id: "klaim_regulasi", severity: "peringatan", message: "Klaim regulasi (BPOM/halal/HS code) belum terbukti. Verifikasi ke sumber resmi atau tandai [PERLU DIBUKTIKAN].", evidence: clip(s) });
    }
  }

  if (!incoming) {
    if (RE_PAYMENT_MENTION.test(text) && !RE_PAYMENT_OK.test(text)) {
      add({ id: "metode_bayar_tidak_disebut", severity: "peringatan", message: "Pembayaran disebut tanpa L/C at sight BNI atau Alibaba Trade Assurance.", evidence: "" });
    }
    if (RE_SHIPPING.test(text) && !RE_COLLECT.test(text) && !SAMPLE.test(text)) {
      add({ id: "dhl_collect_tidak_disebut", severity: "peringatan", message: "Pengiriman disebut tanpa DHL Collect (ongkir ditagih ke penerima).", evidence: "" });
    }
    if (RE_ORDER.test(text) && !RE_DOCS.test(text)) {
      add({ id: "dokumen_wajib_tidak_disebut", severity: "peringatan", message: "Order/proforma disebut tanpa meminta halal, LoA BPOM, atau CFS.", evidence: "" });
    }
    if (opts.requireDraftMarker && !RE_MARKER.test(text)) {
      add({ id: "penanda_draf_hilang", severity: "peringatan", message: "Draf belum ditandai 'DRAFT - belum dikirim, menunggu persetujuan'.", evidence: "" });
    }
  }

  findings.sort((a, b) => Number(b.severity === "blokir") - Number(a.severity === "blokir"));
  const blocking = findings.filter((f) => f.severity === "blokir").length;
  return { ok: blocking === 0, blocking, findings };
}
