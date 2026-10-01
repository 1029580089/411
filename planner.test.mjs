import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {InputError, plan, toCsv} from './planner.mjs';
const sample = JSON.parse(readFileSync(new URL('./sample.json', import.meta.url), 'utf8'));

test('sample plan is deterministic and explains every order', () => {
  const first = plan(sample); const second = plan(sample);
  assert.deepEqual(first, second);
  assert.equal(first.orders.length, 5);
  // 1,190 reserved minutes / (7 * (480 + 420 + 360) - 420 downtime) = 14.166...%.
  assert.deepEqual(first.summary, {total: 5, onTime: 2, late: 1, blocked: 2, utilization: 14.2});
  assert.equal(first.orders.find(o => o.id === 'WO-1003').reason, 'material');
  assert.equal(first.orders.find(o => o.id === 'WO-1005').reason, 'dependency');
  assert.equal(first.orders.find(o => o.id === 'WO-1002').finishDate, '2026-10-04');
});

test('material shortage blocks without consuming stock', () => {
  const input = structuredClone(sample);
  input.stock.STEEL = 1;
  const result = plan(input);
  const blocked = result.orders.find(order => order.id === 'WO-1002');
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.reason, 'material');
  assert.equal(result.stockRemaining.STEEL, 1);
  assert.equal(blocked.shortages[0].available, 1);
});

test('capacity shortage does not partially reserve a work order', () => {
  const input = structuredClone(sample);
  input.horizonDays = 1;
  input.orders = [structuredClone(sample.orders[2])];
  input.machines = [{id: 'CNC', dailyMinutes: 10, downtime: []}];
  input.orders[0].route = [{machine: 'CNC', minutesPerUnit: 8}];
  const result = plan(input);
  assert.equal(result.orders[0].reason, 'capacity');
  assert.equal(result.load[0].used, 0);
  assert.equal(result.stockRemaining.STEEL, 100);
});

const simple = () => ({startDate: '2026-10-01', horizonDays: 5, machines: [{id: 'M', dailyMinutes: 60}], stock: {S: 10}, orders: [{id: 'A', quantity: 2, priority: 2, dueDate: '2026-10-05', bom: {S: 1}, route: [{machine: 'M', minutesPerUnit: 40}], dependsOn: []}]});

test('operations split across days without overbooking', () => {
  const result = plan(simple());
  assert.deepEqual(result.orders[0].allocations.map(a => a.minutes), [60, 20]);
  assert.equal(result.orders[0].finishDate, '2026-10-02');
});
test('next operation starts on a later day, even on the same machine', () => {
  const input = simple(); input.orders[0].route.push({machine: 'M', minutesPerUnit: 10});
  const result = plan(input);
  assert.equal(result.orders[0].allocations.at(-1).date, '2026-10-03');
});
test('dependencies start after predecessor finishes', () => {
  const input = simple(); input.orders.push({...structuredClone(input.orders[0]), id: 'B', priority: 3, dependsOn: ['A']});
  const result = plan(input);
  assert.equal(result.orders[1].id, 'B');
  assert.equal(result.orders[1].startDate, '2026-10-03');
});
test('release date and machine downtime both constrain the plan', () => {
  const input = simple(); input.orders[0].releaseDate = '2026-10-02'; input.machines[0].downtime = ['2026-10-02'];
  const result = plan(input);
  assert.equal(result.orders[0].startDate, '2026-10-03');
  assert.equal(result.load[1].available, 0);
});
test('competing orders reserve material once, in priority order', () => {
  const input = simple(); input.stock.S = 2;
  input.orders.push({...structuredClone(input.orders[0]), id: 'B', priority: 3});
  const result = plan(input);
  assert.equal(result.orders[0].id, 'B'); assert.equal(result.orders[1].reason, 'material');
  assert.equal(result.stockRemaining.S, 0);
});
test('failed second operation rolls back the first operation and stock', () => {
  const input = simple(); input.horizonDays = 2;
  input.orders[0].route.push({machine: 'M', minutesPerUnit: 10});
  input.orders.push({...structuredClone(input.orders[0]), id: 'B', priority: 1, quantity: 1, route: [{machine: 'M', minutesPerUnit: 30}]});
  const result = plan(input);
  assert.equal(result.orders[0].reason, 'capacity');
  assert.equal(result.orders[1].startDate, '2026-10-01');
  assert.equal(result.stockRemaining.S, 9);
  assert.equal(result.load.reduce((s, item) => s + item.used, 0), 30);
});
test('equal priority uses earlier due date then ID', () => {
  const input = simple(); input.orders.push({...structuredClone(input.orders[0]), id: 'B', dueDate: '2026-10-02'});
  assert.equal(plan(input).orders[0].id, 'B');
  input.orders[1].dueDate = input.orders[0].dueDate;
  input.orders.reverse(); assert.equal(plan(input).orders[0].id, 'A');
});
test('planning does not mutate input', () => {
  const input = simple(), before = structuredClone(input); plan(input); assert.deepEqual(input, before);
});
test('zero-capacity calendar and empty order list have defined results', () => {
  const input = simple(); input.horizonDays = 1; input.machines[0].downtime = ['2026-10-01'];
  assert.equal(plan(input).summary.utilization, 0);
  input.orders = []; assert.deepEqual(plan(input).summary, {total: 0, onTime: 0, late: 0, blocked: 0, utilization: 0});
});
for (const [label, edit] of [
  ['invalid calendar date', x => { x.startDate = '2026-02-30'; }],
  ['negative stock', x => { x.stock.S = -1; }],
  ['fractional quantity', x => { x.orders[0].quantity = 1.5; }],
  ['unknown machine', x => { x.orders[0].route[0].machine = 'UNKNOWN'; }],
  ['duplicate order', x => { x.orders.push(structuredClone(x.orders[0])); }],
  ['missing dependency', x => { x.orders[0].dependsOn = ['UNKNOWN']; }],
  ['invalid horizon', x => { x.horizonDays = 91; }],
  ['unsafe material key', x => { x.stock['=BAD'] = 1; }]
]) test(`validation rejects ${label}`, () => { const input = simple(); edit(input); assert.throws(() => plan(input), InputError); });

test('generated workloads conserve stock, capacity and operation minutes', () => {
  let seed = 73;
  const random = n => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
  for (let trial = 0; trial < 100; trial++) {
    const input = simple(); input.stock.S = random(30); input.horizonDays = 10;
    input.orders = Array.from({length: 12}, (_, index) => ({id: `W${index}`, quantity: random(5) + 1, priority: random(3) + 1, dueDate: `2026-10-${String(random(9) + 1).padStart(2, '0')}`, bom: {S: 1}, route: [{machine: 'M', minutesPerUnit: random(40) + 1}], dependsOn: []}));
    const result = plan(input), scheduled = result.orders.filter(o => o.status !== 'blocked');
    assert.equal(input.stock.S, result.stockRemaining.S + scheduled.reduce((sum, o) => sum + o.quantity, 0));
    assert.ok(result.load.every(load => load.used >= 0 && load.used <= load.available));
    assert.equal(result.load.reduce((sum, load) => sum + load.used, 0), scheduled.reduce((sum, o) => sum + o.allocations.reduce((s, a) => s + a.minutes, 0), 0));
    for (const order of scheduled) {
      const source = input.orders.find(o => o.id === order.id);
      assert.equal(order.allocations.reduce((sum, a) => sum + a.minutes, 0), source.quantity * source.route[0].minutesPerUnit);
    }
  }
});

test('dependency cycles and missing materials are rejected', () => {
  const input = structuredClone(sample);
  input.orders[0].dependsOn = ['WO-1004'];
  assert.throws(() => plan(input), InputError);
  const missing = structuredClone(sample);
  missing.orders[0].bom.COPPER = 1;
  assert.throws(() => plan(missing), /未定义物料/);
});

test('CSV quotes cells and neutralizes formula-like values', () => {
  const csv = toCsv({orders: [{id: '=unsafe', status: 'blocked', quantity: 1, dueDate: '2026-01-01', lateDays: 0}],});
  assert.match(csv, /'=unsafe/);
  assert.match(csv, /"工单"/);
});
