import { describe, it } from 'vitest';
import { cases } from './cases';

describe('玩法一规则', () => {
  for (const c of cases) {
    it(c.name, () => c.run());
  }
});
