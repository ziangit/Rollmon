// Random sources for the pure layer. Python's reference takes `random.Random`
// style objects; here each consumer declares the operations it needs so tests
// can inject deterministic stubs (first choice, recorded weights, ...).

export interface ChoiceRng { choice<T>(sequence: readonly T[]): T }
export interface WeightedRng { weightedChoice<T>(population: readonly T[], weights: readonly number[]): T }
export interface SampleRng { sample<T>(population: readonly T[], k: number): T[] }
export type Rng = ChoiceRng & WeightedRng & SampleRng;

/** Small fast seeded PRNG (uniform in [0, 1)). */
export function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngFrom(random: () => number): Rng {
  return {
    choice(sequence) {
      if (sequence.length === 0) throw new Error('choice from empty sequence');
      return sequence[Math.floor(random() * sequence.length)];
    },
    weightedChoice(population, weights) {
      if (population.length === 0 || population.length !== weights.length) throw new Error('weightedChoice needs one weight per item');
      const total = weights.reduce((a, b) => a + b, 0);
      if (!(total > 0)) throw new Error('weightedChoice needs a positive total weight');
      let roll = random() * total;
      for (let i = 0; i < population.length; i++) {
        roll -= weights[i];
        if (roll < 0) return population[i];
      }
      return population[population.length - 1];
    },
    sample(population, k) {
      if (k > population.length) throw new Error('sample larger than population');
      const pool = [...population];
      const out: typeof pool = [];
      for (let i = 0; i < k; i++) {
        const j = i + Math.floor(random() * (pool.length - i));
        [pool[i], pool[j]] = [pool[j], pool[i]];
        out.push(pool[i]);
      }
      return out;
    },
  };
}

export const seededRng = (seed: number): Rng => rngFrom(mulberry32(seed));
export const defaultRng: Rng = rngFrom(Math.random);
