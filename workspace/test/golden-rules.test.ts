import { describe, expect, it } from "vitest";
import { checkGoldenRules } from "../src/lib/goldenRules";

const draft = (t: string, marker = false) => checkGoldenRules(t, { direction: "draft", requireDraftMarker: marker });
const incoming = (t: string) => checkGoldenRules(t, { direction: "incoming" });
const ids = (r: ReturnType<typeof draft>) => r.findings.map((f) => f.id);

describe("checkGoldenRules (draf keluar)", () => {
  it("memblokir draf yang menerima DP/prepayment", () => {
    const r = draft("We will pay a 30% deposit and 70% before shipment.");
    expect(r.ok).toBe(false);
    expect(ids(r)).toContain("pembayaran_di_muka");
  });
  it("tidak memblokir draf yang menolak DP dan menawarkan L/C", () => {
    const r = draft("We do not accept prepayment. Payment is by L/C at sight BNI.");
    expect(ids(r)).not.toContain("pembayaran_di_muka");
    expect(ids(r)).not.toContain("metode_bayar_tidak_disebut");
  });
  it("penerimaan eksplisit mengalahkan kata 'no' di kalimat yang sama", () => {
    expect(ids(draft("We accept the 30% deposit, no problem."))).toContain("pembayaran_di_muka");
  });
  it("memblokir sampel berbayar dan membolehkan sampel gratis", () => {
    expect(ids(draft("We will pay the sample fee of USD 45."))).toContain("sampel_berbayar");
    expect(ids(draft("Please send a free sample, shipping cost at your expense."))).not.toContain("sampel_berbayar");
  });
  it("memblokir komitmen pembelian, tetapi bukan penolakan komitmen", () => {
    expect(ids(draft("We would like to place the order for 500 units."))).toContain("komitmen_pembelian");
    expect(ids(draft("We cannot confirm the order until the documents are received."))).not.toContain("komitmen_pembelian");
    expect(ids(draft("Kami setuju dengan harga tersebut."))).toContain("komitmen_pembelian");
  });
  it("memblokir kebocoran aturan/anggaran internal", () => {
    const r = draft("Our internal budget is limited, and our Aturan Emas forbids this.");
    expect(ids(r)).toContain("kebocoran_internal");
    expect(r.ok).toBe(false);
  });
  it("memperingatkan klaim regulasi yang belum terbukti, dan diam bila ditandai", () => {
    expect(ids(draft("The product is BPOM registered and halal certified."))).toContain("klaim_regulasi");
    expect(ids(draft("The product is BPOM registered [PERLU DIBUKTIKAN]."))).not.toContain("klaim_regulasi");
  });
  it("memperingatkan DHL Collect, dokumen wajib, dan penanda draf yang hilang", () => {
    const r = draft("Please send the proforma invoice with shipping by courier.", true);
    expect(ids(r)).toEqual(expect.arrayContaining(["dhl_collect_tidak_disebut", "dokumen_wajib_tidak_disebut", "penanda_draf_hilang", "metode_bayar_tidak_disebut"]));
    expect(r.ok).toBe(true);
  });
  it("draf yang bersih lolos tanpa temuan", () => {
    const r = draft("Please send a free sample with shipping at supplier's cost, plus halal, LoA BPOM and CFS. DRAFT - belum dikirim, menunggu persetujuan", true);
    expect(r).toEqual({ ok: true, blocking: 0, findings: [] });
  });
});

describe("checkGoldenRules (pesan masuk)", () => {
  it("menandai permintaan DP, sampel berbayar, dan tidak ada halal sebagai peringatan", () => {
    const r = incoming("We require 50% prepayment. The sample fee is USD 300. We do not have halal certification.");
    expect(ids(r)).toEqual(expect.arrayContaining(["pembayaran_di_muka", "sampel_berbayar", "halal_tidak_ada"]));
    expect(r.findings.every((f) => f.severity === "peringatan")).toBe(true);
    expect(r.ok).toBe(true);
  });
  it("tidak menerapkan aturan draf ke pesan masuk", () => {
    expect(ids(incoming("Please confirm the order and shipping."))).toEqual([]);
  });
});

describe("checkGoldenRules (batas)", () => {
  it("membatasi temuan per aturan dan memotong bukti", () => {
    const r = draft(Array.from({ length: 10 }, () => "We will pay a deposit " + "x".repeat(300) + ".").join("\n"));
    expect(r.findings.filter((f) => f.id === "pembayaran_di_muka")).toHaveLength(3);
    expect(r.findings[0].evidence.length).toBeLessThanOrEqual(140);
  });
  it("selesai cepat pada teks 20.000 karakter yang patologis", () => {
    const t = ("BPOM " + "a ".repeat(30)).repeat(300);
    const t0 = Date.now();
    checkGoldenRules(t.slice(0, 20000), { direction: "draft" });
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
