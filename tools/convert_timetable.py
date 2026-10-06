"""학교 시스템에서 내려받은 학생별 시간표(.xls, 실제로는 HTML)를 앱의 TIMETABLE 형식으로 변환.

사용법: python tools/convert_timetable.py 시간표1.xls [시간표2.xls ...] > out.json
출력: {"반번호": {"번호": {"s": {"교시": {"요일": {"s":과목,"t":교사,"r":교실}}}}}}
학생 이름은 공개 사이트에 올라가지 않도록 넣지 않는다.
"""
import sys, re, json, html as H
from html.parser import HTMLParser

DAYS = ['월', '화', '수', '목', '금']

class Table(HTMLParser):
    def __init__(self):
        super().__init__(); self.rows = []; self.row = None; self.cell = None; self.title = None
    def handle_starttag(self, tag, attrs):
        if tag == 'tr': self.row = []
        elif tag in ('td', 'th'): self.cell = []
        elif tag == 'br' and self.cell is not None: self.cell.append('\n')
        elif tag == 'span' and self.cell is not None:
            t = dict(attrs).get('title')
            if t: self.title = t  # '김배영 외2명' 대신 전체 교사 목록
    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.cell is not None:
            self.row.append((''.join(self.cell), self.title)); self.cell = None; self.title = None
        elif tag == 'tr' and self.row is not None: self.rows.append(self.row); self.row = None
    def handle_data(self, d):
        if self.cell is not None: self.cell.append(d)

def parse(path):
    raw = open(path, 'rb').read()
    try: s = raw.decode('utf-8')
    except UnicodeDecodeError: s = raw.decode('cp949')
    out = {}
    for m in re.finditer(r'\(2(\d{2})(\d{2})\)\s*(?:<[^>]*>\s*)*<table.*?</table>', s, re.S):
        cls, num = str(int(m.group(1))), str(int(m.group(2)))
        p = Table(); p.feed(m.group(0)[m.group(0).find('<table'):])
        sched = {}
        for row in p.rows[1:]:
            period = row[0][0].strip()
            if not period.isdigit(): continue
            for d, (txt, title) in zip(DAYS, row[1:]):
                parts = [x.strip() for x in H.unescape(txt).split('\n')]
                parts += [''] * (3 - len(parts))
                if not parts[0]: continue
                sched.setdefault(period, {})[d] = {
                    's': parts[0], 't': (title or parts[1]).replace(' ', ''), 'r': parts[2]}
        out.setdefault(cls, {})[num] = {'s': sched}
    return out

if __name__ == '__main__':
    merged = {}
    for f in sys.argv[1:]:
        for cls, stus in parse(f).items():
            merged.setdefault(cls, {}).update(stus)
    for cls in sorted(merged, key=int):
        print(f'{cls}반 {len(merged[cls])}명', file=sys.stderr)
    json.dump(merged, sys.stdout, ensure_ascii=False, separators=(',', ':'))
