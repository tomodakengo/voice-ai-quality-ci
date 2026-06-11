#!/usr/bin/env python3
"""ペアワイズ(2因子網羅)テストケース生成。

Microsoft PICT が無い環境でも回るよう、PICT 形式の .pict を解釈して
貪欲法でペアワイズ被覆する組み合わせを出力する自前実装。

使い方:
    python scripts/pairwise.py eval/factors.pict
    python scripts/pairwise.py eval/factors.pict --json eval/out/pairwise.json

出力末尾に「全組み合わせ数 vs ペアワイズ件数」を表示する(記事の件数差ネタ)。
依存: 標準ライブラリのみ。
"""
from __future__ import annotations
import sys
import json
import itertools
from pathlib import Path


def parse_pict(path: Path) -> dict[str, list[str]]:
    factors: dict[str, list[str]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("IF"):
            continue
        if ":" not in line:
            continue
        name, rest = line.split(":", 1)
        values = [v.strip() for v in rest.split(",") if v.strip()]
        if values:
            factors[name.strip()] = values
    return factors


def all_pairs(factors: dict[str, list[str]]) -> set[tuple]:
    names = list(factors)
    pairs: set[tuple] = set()
    for a, b in itertools.combinations(names, 2):
        for va in factors[a]:
            for vb in factors[b]:
                pairs.add(((a, va), (b, vb)))
    return pairs


def gen_pairwise(factors: dict[str, list[str]]) -> list[dict[str, str]]:
    """貪欲法(seed-from-uncovered): 未被覆ペアを種にして1行を組み立てる。

    各反復で必ず1つ以上の未被覆ペアをカバーするので、全ペア網羅で停止する。
    残りの因子は「確定済み因子との新規ペアを最大化する水準」を貪欲に選ぶ。
    """
    names = list(factors)
    uncovered = all_pairs(factors)
    rows: list[dict[str, str]] = []

    def pairs_of(row: dict[str, str]) -> set[tuple]:
        s = set()
        for a, b in itertools.combinations(names, 2):
            s.add(((a, row[a]), (b, row[b])))
        return s

    def gain_with(name: str, v: str, row: dict[str, str]) -> int:
        g = 0
        for other, ov in row.items():
            key1 = ((name, v), (other, ov))
            key2 = ((other, ov), (name, v))
            if key1 in uncovered or key2 in uncovered:
                g += 1
        return g

    guard = 0
    while uncovered and guard < 100000:
        guard += 1
        # 未被覆ペアを1つ取り、その2因子を種にする(決定性のため sorted で先頭)
        seed = sorted(uncovered)[0]
        (fa, va), (fb, vb) = seed
        row: dict[str, str] = {fa: va, fb: vb}
        for name in names:
            if name in row:
                continue
            best_v = factors[name][0]
            best_local = -1
            for v in factors[name]:
                g = gain_with(name, v, row)
                if g > best_local:
                    best_local = g
                    best_v = v
            row[name] = best_v
        rows.append(row)
        uncovered -= pairs_of(row)
    return rows


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: pairwise.py <model.pict> [--json out.json]", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    factors = parse_pict(path)
    if not factors:
        print("因子が見つかりません。", file=sys.stderr)
        return 2

    rows = gen_pairwise(factors)
    names = list(factors)

    # 表示
    print("\t".join(names))
    for r in rows:
        print("\t".join(r[n] for n in names))

    full = 1
    for v in factors.values():
        full *= len(v)
    print(f"\n# 因子数={len(names)}  全組み合わせ={full}  ペアワイズ={len(rows)} "
          f"({len(rows) / full:.1%} に削減)", file=sys.stderr)

    if "--json" in sys.argv:
        out = Path(sys.argv[sys.argv.index("--json") + 1])
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(
            {"factors": factors, "cases": rows, "fullCount": full, "pairwiseCount": len(rows)},
            ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"# wrote {out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
