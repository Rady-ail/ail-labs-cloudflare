/* Rumus landed cost: satu sumber untuk server (penyimpanan) dan antarmuka (tampilan). */
export type LandedInput = {
  fob: number; qty: number; kurs: number; freight: number; insPct: number;
  dutyPct: number; ppnPct: number; pphPct: number; other: number; margin: number; taxCost: boolean;
};
export type LandedResult = {
  goods: number; freight: number; ins: number; cif: number; duty: number;
  ppn: number; pph: number; total: number; unit: number; price: number;
};

export function computeLanded(f: LandedInput): LandedResult {
  const goods = f.fob * f.qty * f.kurs;
  const freight = f.freight * f.kurs;
  const ins = (goods + freight) * (f.insPct / 100);
  const cif = goods + freight + ins;
  const duty = cif * (f.dutyPct / 100);
  const base = cif + duty;
  const ppn = base * (f.ppnPct / 100);
  const pph = base * (f.pphPct / 100);
  const total = cif + duty + (f.taxCost ? ppn + pph : 0) + f.other;
  const unit = f.qty > 0 ? total / f.qty : NaN;
  const price = f.margin < 100 ? unit / (1 - f.margin / 100) : NaN;
  return { goods, freight, ins, cif, duty, ppn, pph, total, unit, price };
}
