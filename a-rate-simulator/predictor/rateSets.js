// 나이스 [통합산출] 예상정답률 입력 세트 생성기
// 교사별 분할점수 = Σ(배점합 × 최소능력자 예상정답률), 최종 분할점수 = 교사 평균.
// 규칙: 5% 단위, 한 줄 안에서 A > B > C > D, 같은 문항구분 안에서 쉬움 ≥ 보통 ≥ 어려움.
(function (global) {
  "use strict";

  const UNIT = 5;
  const MAX_UNITS = 100 / UNIT;
  const COLUMNS = 4; // A, B, C, D
  const LEVEL_FACTOR = [1.2, 1.0, 0.75]; // 쉬움, 보통, 어려움의 출발 비율
  const TEACHER_SPREAD = 0.02; // 교사별 개인 목표를 만점의 ±2% 범위로 흩뜨린다

  function seeded(seed) {
    let value = seed >>> 0;
    return () => {
      value += 0x6D2B79F5;
      let result = value;
      result = Math.imul(result ^ (result >>> 15), result | 1);
      result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
      return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function cutOf(groups, units, column) {
    return groups.reduce((sum, group, row) => sum + group.weight * units[row][column] * UNIT / 100, 0);
  }

  // 같은 문항구분 안에서 바로 쉬운 줄/바로 어려운 줄
  function relations(groups) {
    return groups.map((group) => {
      const siblings = groups
        .map((other, row) => ({ row, level: other.level, type: other.type }))
        .filter((other) => other.type === group.type);
      const easier = siblings.filter((other) => other.level < group.level)
        .sort((a, b) => b.level - a.level)[0];
      const harder = siblings.filter((other) => other.level > group.level)
        .sort((a, b) => a.level - b.level)[0];
      return { easier: easier ? easier.row : -1, harder: harder ? harder.row : -1 };
    });
  }

  function canSet(units, rel, row, column, value) {
    if (value < 0 || value > MAX_UNITS) return false;
    const line = units[row];
    if (column > 0 && line[column - 1] <= value) return false;
    if (column < COLUMNS - 1 && line[column + 1] >= value) return false;
    if (rel[row].easier >= 0 && units[rel[row].easier][column] < value) return false;
    if (rel[row].harder >= 0 && units[rel[row].harder][column] > value) return false;
    return true;
  }

  function initialUnits(groups, targets, random) {
    const totalWeight = groups.reduce((sum, group) => sum + group.weight, 0);
    const units = groups.map(() => Array(COLUMNS).fill(0));
    for (let column = 0; column < COLUMNS; column += 1) {
      const averageRate = clamp(targets[column] / totalWeight * 100, 0, 100);
      const factors = groups.map((group) =>
        LEVEL_FACTOR[group.level] * (1 + (random() - 0.5) * 0.16)
      );
      const norm = totalWeight / groups.reduce((sum, group, row) => sum + group.weight * factors[row], 0);
      groups.forEach((_, row) => {
        units[row][column] = clamp(Math.round(averageRate * factors[row] * norm / UNIT), 0, MAX_UNITS);
      });
    }
    // 한 줄 안에서 A > B > C > D
    units.forEach((line) => {
      line[0] = clamp(line[0], COLUMNS - 1, MAX_UNITS);
      for (let column = 1; column < COLUMNS; column += 1) {
        line[column] = clamp(line[column], COLUMNS - 1 - column, line[column - 1] - 1);
      }
    });
    // 같은 문항구분 안에서 쉬움 ≥ 보통 ≥ 어려움 (열마다 정렬해도 줄 순서는 유지된다)
    [...new Set(groups.map((group) => group.type))].forEach((type) => {
      const rows = groups
        .map((group, row) => ({ row, level: group.level, type: group.type }))
        .filter((item) => item.type === type)
        .sort((a, b) => a.level - b.level)
        .map((item) => item.row);
      for (let column = 0; column < COLUMNS; column += 1) {
        const values = rows.map((row) => units[row][column]).sort((a, b) => b - a);
        rows.forEach((row, index) => { units[row][column] = values[index]; });
      }
    });
    return units;
  }

  // 한 칸씩 ±5%를 바꿔 각 열의 분할점수를 개인 목표에 가깝게 맞춘다
  function fitTeacher(groups, rel, units, targets) {
    for (let step = 0; step < 2000; step += 1) {
      let best = null;
      for (let column = 0; column < COLUMNS; column += 1) {
        const current = cutOf(groups, units, column);
        const error = Math.abs(current - targets[column]);
        groups.forEach((group, row) => {
          [-1, 1].forEach((delta) => {
            const value = units[row][column] + delta;
            if (!canSet(units, rel, row, column, value)) return;
            const gain = error - Math.abs(current + delta * group.weight * UNIT / 100 - targets[column]);
            if (gain > 1e-9 && (!best || gain > best.gain)) best = { gain, row, column, value };
          });
        });
      }
      if (!best) return;
      units[best.row][best.column] = best.value;
    }
  }

  // 교사 평균이 목표에 가장 가깝도록 아무 교사의 한 칸을 ±5%씩 조정한다
  function fitAverage(groups, rel, teachers, targets) {
    const count = teachers.length;
    for (let step = 0; step < 4000; step += 1) {
      let best = null;
      for (let column = 0; column < COLUMNS; column += 1) {
        const average = teachers.reduce((sum, units) => sum + cutOf(groups, units, column), 0) / count;
        const error = Math.abs(average - targets[column]);
        teachers.forEach((units, teacher) => {
          groups.forEach((group, row) => {
            [-1, 1].forEach((delta) => {
              const value = units[row][column] + delta;
              if (!canSet(units, rel, row, column, value)) return;
              const gain = error - Math.abs(average + delta * group.weight * UNIT / 100 / count - targets[column]);
              if (gain > 1e-9 && (!best || gain > best.gain)) best = { gain, teacher, row, column, value };
            });
          });
        });
      }
      if (!best) best = bestPairMove(groups, rel, teachers, targets);
      if (!best) return;
      if (best.pair) {
        const units = teachers[best.teacher];
        units[best.up][best.column] += 1;
        units[best.down][best.column] -= 1;
      } else {
        teachers[best.teacher][best.row][best.column] = best.value;
      }
    }
  }

  // 한 칸 조정으로 더 가까워지지 않으면, 한 교사의 두 줄을 +5%/-5% 동시에 바꿔 미세 조정한다
  function bestPairMove(groups, rel, teachers, targets) {
    const count = teachers.length;
    let best = null;
    for (let column = 0; column < COLUMNS; column += 1) {
      const average = teachers.reduce((sum, units) => sum + cutOf(groups, units, column), 0) / count;
      const error = Math.abs(average - targets[column]);
      teachers.forEach((units, teacher) => {
        groups.forEach((upGroup, up) => {
          groups.forEach((downGroup, down) => {
            if (up === down) return;
            const change = (upGroup.weight - downGroup.weight) * UNIT / 100 / count;
            const gain = error - Math.abs(average + change - targets[column]);
            if (!(gain > 1e-9) || (best && gain <= best.gain)) return;
            if (!canSet(units, rel, up, column, units[up][column] + 1)) return;
            units[up][column] += 1;
            const ok = canSet(units, rel, down, column, units[down][column] - 1);
            units[up][column] -= 1;
            if (ok) best = { pair: true, gain, teacher, up, down, column };
          });
        });
      });
    }
    return best;
  }

  // groups: [{ type, level(0 쉬움·1 보통·2 어려움), weight }], weight 0인 줄은 제외
  // targets: [A/B, B/C, C/D, D/E] 목표 분할점수
  function buildSets(allGroups, targets, teacherCount) {
    const groups = allGroups
      .map((group, index) => ({ ...group, index }))
      .filter((group) => group.weight > 0);
    if (!groups.length || !targets.every(Number.isFinite) || !(teacherCount >= 1)) return null;
    const rel = relations(groups);
    const totalWeight = groups.reduce((sum, group) => sum + group.weight, 0);
    const order = Array.from({ length: teacherCount }, (_, index) => index);
    const shuffle = seeded(20261123 + teacherCount * 131);
    for (let index = order.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(shuffle() * (index + 1));
      [order[index], order[swap]] = [order[swap], order[index]];
    }
    const teachers = order.map((position, teacher) => {
      const offset = teacherCount > 1
        ? totalWeight * TEACHER_SPREAD * (position / (teacherCount - 1) * 2 - 1)
        : 0;
      const personal = targets.map((target) => target + offset);
      const units = initialUnits(groups, personal, seeded(7919 * (teacher + 1) + teacherCount * 31));
      fitTeacher(groups, rel, units, personal);
      return units;
    });
    fitAverage(groups, rel, teachers, targets);
    const teacherResults = teachers.map((units) => ({
      rates: units.map((line) => line.map((value) => value * UNIT)),
      cuts: Array.from({ length: COLUMNS }, (_, column) => cutOf(groups, units, column)),
    }));
    return {
      groups,
      targets,
      teachers: teacherResults,
      average: Array.from({ length: COLUMNS }, (_, column) =>
        teacherResults.reduce((sum, teacher) => sum + teacher.cuts[column], 0) / teacherCount
      ),
    };
  }

  function isValidSet(result) {
    const rel = relations(result.groups);
    return result.teachers.every((teacher) => {
      const units = teacher.rates.map((line) => line.map((value) => value / UNIT));
      return units.every((line, row) => line.every((value, column) =>
        Number.isInteger(value) && canSet(units, rel, row, column, value)
      ));
    });
  }

  global.RateSets = { buildSets, isValidSet, UNIT };
})(typeof window !== "undefined" ? window : globalThis);
