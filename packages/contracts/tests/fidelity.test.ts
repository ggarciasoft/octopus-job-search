import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import { buildPython } from '../scripts/generate.js';
import { EXPORTED_SCHEMAS } from '../src/exports.js';
// Registers the `uuid` and `date-time` formats as a side effect.
import '../src/index.js';
import corpus from './validation-corpus.json' with { type: 'json' };

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const WORKER_DIR = join(REPO_ROOT, 'services', 'worker');
const CORPUS_FILE = join(HERE, 'validation-corpus.json');

interface CorpusCase {
  readonly id: string;
  readonly schema: string;
  readonly valid: boolean;
  readonly constraint: string;
  readonly payload: unknown;
}

const cases = corpus.cases as unknown as CorpusCase[];

describe('validation corpus', () => {
  it('is well formed and names a real schema for every case', () => {
    expect(cases.length).toBeGreaterThan(30);
    const ids = cases.map((entry) => entry.id);
    expect(new Set(ids).size, 'case ids must be unique').toBe(ids.length);
    for (const entry of cases) {
      expect(EXPORTED_SCHEMAS[entry.schema], `${entry.id} names an unknown schema`).toBeDefined();
    }
  });

  it('has at least one valid control for every schema it exercises', () => {
    const schemas = new Set(cases.map((entry) => entry.schema));
    for (const schema of schemas) {
      const controls = cases.filter((entry) => entry.schema === schema && entry.valid);
      expect(controls.length, `${schema} has no valid control`).toBeGreaterThan(0);
    }
  });

  it('exercises every constraint family the generator is responsible for', () => {
    const families = cases.map((entry) => entry.constraint).join(' ');
    for (const family of [
      'minLength',
      'maxLength',
      'pattern',
      'minimum',
      'maximum',
      'minItems',
      'maxItems',
      'additionalProperties',
      'format uuid',
      'format date-time',
    ]) {
      expect(families, `no case covers ${family}`).toContain(family);
    }
  });
});

describe('TypeBox reaches the expected verdict on every corpus case', () => {
  for (const entry of cases) {
    it(`${entry.id} (${entry.constraint})`, () => {
      const schema = EXPORTED_SCHEMAS[entry.schema]!;
      expect(Value.Check(schema, entry.payload)).toBe(entry.valid);
    });
  }
});

/**
 * Static proof that the constraints survive code generation. This is the check
 * that would have caught the regression where every Pydantic field was emitted
 * bare: the models validated far less than the contract promised, and nothing
 * failed until a result reached the API boundary.
 */
describe('generated Pydantic models carry the schema constraints', () => {
  const models = buildPython().models;

  /**
   * The whole annotation for one field, flattened onto a single line. Fields
   * whose annotation is too long for the Ruff line length are emitted wrapped
   * across several lines, so this must not stop at the first newline.
   */
  const fieldLine = (model: string, field: string): string => {
    const start = models.indexOf(`class ${model}(BaseModel):`);
    expect(start, `no model ${model}`).toBeGreaterThanOrEqual(0);
    const nextClass = models.indexOf('\nclass ', start + 1);
    const body = models.slice(start, nextClass === -1 ? undefined : nextClass);
    // Stop at the next field declaration at class-body indentation, or at the
    // end of the class.
    const match = new RegExp(
      `\\n {4}${field}: ([\\s\\S]*?)(?=\\n {4}[A-Za-z_][A-Za-z0-9_]*: |\\n*$)`,
    ).exec(body);
    expect(match, `no field ${model}.${field}`).not.toBeNull();
    return match![1]!.replace(/\s+/g, ' ');
  };

  it('emits at least one Field() constraint per constrained schema', () => {
    expect((models.match(/Field\(/g) ?? []).length).toBeGreaterThan(100);
  });

  it('carries string patterns', () => {
    expect(fieldLine('ExperienceValue', 'start_month')).toContain('pattern=');
    expect(fieldLine('AuthorizationValue', 'country')).toContain('pattern=r"^[A-Z]{2}$"');
    expect(fieldLine('FileView', 'sha256')).toContain('pattern=r"^[a-f0-9]{64}$"');
  });

  it('carries string lengths', () => {
    expect(fieldLine('NoopEchoInput', 'message')).toContain('min_length=1');
    expect(fieldLine('NoopEchoInput', 'message')).toContain('max_length=500');
    expect(fieldLine('ClaimResponse', 'lease_token')).toContain('min_length=32');
  });

  it('carries numeric ranges, including inside a nullable union', () => {
    expect(fieldLine('DraftFact', 'confidence')).toContain('ge=0');
    expect(fieldLine('DraftFact', 'confidence')).toContain('le=1');
    expect(fieldLine('TaskProgress', 'percent')).toContain('le=100');
    expect(fieldLine('ProviderLimits', 'daily_token_budget')).toContain('ge=0');
    expect(fieldLine('ProviderLimits', 'daily_token_budget')).toContain('| None');
  });

  it('carries array item counts and constrains the items themselves', () => {
    expect(fieldLine('ExperienceValue', 'bullets')).toContain('max_length=30');
    expect(fieldLine('ExperienceValue', 'skills')).toContain('list[Annotated[str,');
    expect(fieldLine('ClaimRequest', 'capabilities')).toContain('min_length=1');
  });

  it('validates uuid and date-time rather than accepting any string', () => {
    expect(fieldLine('ClaimResponse', 'task_id')).toContain('UuidString');
    expect(fieldLine('ClaimResponse', 'lease_expires_at')).toContain('TimestampString');
    expect(models).toContain('UuidString = Annotated[str, Field(pattern=_UUID_PATTERN)]');
    expect(models).toContain('AfterValidator(_validate_utc_timestamp)');
  });

  it('mirrors the UTC-only date-time rule from src/formats.ts', () => {
    const formats = readFileSync(join(HERE, '..', 'src', 'formats.ts'), 'utf8');
    // Both sides must forbid a non-zero offset; +02:00 is never acceptable.
    expect(formats).toContain('(Z|[+-]00:00)');
    expect(models).toContain('(Z|[+-]00:00)$');
    expect(models).not.toContain('[+-][0-9]{2}:[0-9]{2}');
  });

  it('does not validate the OpenAPI-only "binary" format', () => {
    expect(models).not.toContain('BinaryString');
    expect(models).not.toContain("format='binary'");
  });
});

/**
 * The real agreement check: run the same corpus through the generated Pydantic
 * models and require an identical verdict for every case. Skipped when `uv` is
 * unavailable so the TypeScript suite stays runnable without a Python toolchain.
 */
function uvAvailable(): boolean {
  const probe = spawnSync('uv', ['--version'], { encoding: 'utf8', windowsHide: true });
  return probe.error === undefined && probe.status === 0;
}

const CROSS_RUNTIME_SCRIPT = `
import json, sys
import pydantic
from job_getter_worker.contracts import generated

corpus = json.load(open(sys.argv[1], encoding="utf-8"))
out = []
for case in corpus["cases"]:
    model = getattr(generated, case["schema"])
    try:
        model.model_validate(case["payload"])
        out.append({"id": case["id"], "valid": True, "detail": ""})
    except pydantic.ValidationError as error:
        out.append({"id": case["id"], "valid": False, "detail": error.errors()[0]["type"]})
print(json.dumps(out))
`;

describe.runIf(uvAvailable())('Pydantic and TypeBox agree on every corpus case', () => {
  const result = spawnSync(
    'uv',
    ['run', '--project', WORKER_DIR, 'python', '-c', CROSS_RUNTIME_SCRIPT, CORPUS_FILE],
    { encoding: 'utf8', cwd: WORKER_DIR, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  );

  it('ran the generated models', () => {
    expect(result.status, `uv failed:\n${result.stderr}`).toBe(0);
  });

  const verdicts: Array<{ id: string; valid: boolean; detail: string }> =
    result.status === 0 ? JSON.parse(result.stdout.trim().split('\n').at(-1)!) : [];
  const byId = new Map(verdicts.map((entry) => [entry.id, entry]));

  for (const entry of cases) {
    it(`${entry.id} (${entry.constraint})`, () => {
      const typebox = Value.Check(EXPORTED_SCHEMAS[entry.schema]!, entry.payload);
      const python = byId.get(entry.id);
      expect(python, `no Python verdict for ${entry.id}`).toBeDefined();
      expect(typebox, 'TypeBox disagrees with the corpus').toBe(entry.valid);
      expect(
        python!.valid,
        `Pydantic says ${python!.valid} but TypeBox says ${typebox} (${python!.detail})`,
      ).toBe(typebox);
    });
  }
});

/**
 * Known, deliberate limit of the corpus above: it proves the two runtimes agree
 * on every *constraint*, not on *type coercion*. Pydantic's default lax mode
 * converts a JSON string to an int where TypeBox rejects it.
 *
 * Neither coercion mode matches TypeBox exactly - `strict=True` would fix the
 * string case but start rejecting `1.0` for an integer field, which TypeBox
 * accepts because JSON has no integer type - so this is recorded rather than
 * silently chosen. Changing ConfigDict should make this test fail and force the
 * trade-off to be revisited.
 */
describe('documented coercion divergence', () => {
  it('TypeBox rejects the string "5" for an integer field', () => {
    expect(Value.Check(EXPORTED_SCHEMAS['TaskProgress']!, { stage: 's', percent: '5' })).toBe(
      false,
    );
  });

  it('TypeBox accepts 1.0 for an integer field, because JSON has no integer type', () => {
    expect(Value.Check(EXPORTED_SCHEMAS['TaskProgress']!, { stage: 's', percent: 1.0 })).toBe(true);
  });

  it('the generated models do not opt into strict mode', () => {
    expect(buildPython().models).not.toContain('strict=True');
  });
});
