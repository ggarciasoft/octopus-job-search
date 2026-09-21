import type { AnswerBankEntry, PacketAnswer } from '@job-getter/contracts';
import { Badge, Button, Checkbox, TextField } from '@job-getter/ui';
import { useState } from 'react';
import { useTranslation } from '../i18n/I18nProvider';
import { PROVENANCE_LABEL } from './labels';

/**
 * Editing the answers that go into the next packet revision.
 *
 * Two rules the component enforces rather than merely displays:
 *
 * **Provenance follows the edit.** Take a stored answer and it is marked
 * `answer_bank` with the entry it came from. Type over it and it becomes
 * `user_entered` and forgets the source — because it is no longer that stored
 * answer, and a packet whose provenance says otherwise is a packet that lies
 * about where a sentence came from.
 *
 * **A `never_reuse` question is never offered a stored value.** Assessments,
 * identity and demographic questions carry no "use saved answer" control at
 * all, so the shortest path is also the only allowed one: type it yourself.
 */

export interface DraftAnswer extends PacketAnswer {
  /** True when the user asked to keep this answer for next time. */
  readonly remember: boolean;
}

export function toDraft(answer: PacketAnswer): DraftAnswer {
  return { ...answer, remember: false };
}

export function newDraft(questionKey: string, label: string): DraftAnswer {
  return {
    question_key: questionKey,
    label: label === '' ? null : label,
    // A question the user has just added is unanswered, not answered with an
    // empty string. The distinction is what `needs_input` is built on.
    answer: null,
    required: true,
    sensitivity: 'standard',
    provenance: 'user_entered',
    source_id: null,
    remember: false,
  };
}

/**
 * What the input shows for a stored answer.
 *
 * An unanswered question shows an **empty field**, not the word "null". That
 * sounds like a formatting detail and is not: `String(null)` renders "null",
 * and a user who pressed save would have sent an employer the four characters
 * n-u-l-l as their answer to "Internal referral code". This was live on the
 * review screen until a browser rendered it.
 */
export function toInputValue(answer: PacketAnswer['answer']): string {
  if (answer === null) return '';
  if (Array.isArray(answer)) return answer.join(', ');
  return String(answer);
}

/**
 * What an edited field means.
 *
 * Clearing a field makes the answer **null** again rather than an empty
 * string: "not answered" is a state the packet has, and blanking a box is how
 * a person says it. An empty string would pass the required check and send
 * nothing.
 *
 * A field that held a list stays a list, because a checkbox group matched
 * against the string "Python, Rust" matches no option at all.
 */
export function fromInputValue(
  previous: PacketAnswer['answer'],
  raw: string,
): PacketAnswer['answer'] {
  if (raw.trim() === '') return null;
  if (Array.isArray(previous)) {
    return raw
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '');
  }
  return raw;
}

/** The question key the API will accept, derived the same way the runner does. */
export function normalizeQuestionKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

export interface AnswerEditorProps {
  readonly answers: readonly DraftAnswer[];
  readonly bank: readonly AnswerBankEntry[];
  readonly disabled: boolean;
  readonly onChange: (answers: readonly DraftAnswer[]) => void;
}

export function AnswerEditor({ answers, bank, disabled, onChange }: AnswerEditorProps) {
  const { t } = useTranslation();
  const [newLabel, setNewLabel] = useState('');

  const update = (key: string, patch: Partial<DraftAnswer>) => {
    onChange(answers.map((item) => (item.question_key === key ? { ...item, ...patch } : item)));
  };

  const addQuestion = () => {
    const key = normalizeQuestionKey(newLabel);
    if (key === '' || answers.some((item) => item.question_key === key)) return;
    onChange([...answers, newDraft(key, newLabel.trim())]);
    setNewLabel('');
  };

  return (
    <section className="flex flex-col gap-4" data-testid="answer-editor">
      <h3 className="font-semibold">{t('answers.heading')}</h3>

      {answers.length === 0 ? (
        <p className="text-sm text-slate-700" data-testid="answers-empty">
          {t('answers.empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {answers.map((answer) => {
            const stored = bank.find(
              (entry) =>
                entry.question_key === answer.question_key &&
                entry.confirmed_at !== null &&
                entry.sensitivity !== 'never_reuse',
            );
            const reusable = answer.sensitivity !== 'never_reuse';

            return (
              <li
                key={answer.question_key}
                className="flex flex-col gap-2 rounded border border-slate-200 p-3"
                data-testid="answer-editor-row"
                data-question={answer.question_key}
              >
                <TextField
                  label={answer.label ?? answer.question_key}
                  value={toInputValue(answer.answer)}
                  disabled={disabled}
                  onChange={(event) =>
                    update(answer.question_key, {
                      answer: fromInputValue(answer.answer, event.currentTarget.value),
                      // Editing a stored answer makes it the user's own.
                      provenance: 'user_entered',
                      source_id: null,
                    })
                  }
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="info">{t(PROVENANCE_LABEL[answer.provenance])}</Badge>
                  {answer.sensitivity === 'never_reuse' ? (
                    <Badge tone="attention">{t('packet.neverReuse')}</Badge>
                  ) : null}
                  {stored !== undefined && reusable ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={disabled}
                      onClick={() =>
                        update(answer.question_key, {
                          answer: stored.answer,
                          provenance: 'answer_bank',
                          source_id: stored.id,
                          remember: false,
                        })
                      }
                    >
                      {t('answers.useStored')}
                    </Button>
                  ) : null}
                </div>
                {reusable ? (
                  <Checkbox
                    label={t('answers.remember')}
                    description={t('answers.rememberDescription')}
                    checked={answer.remember}
                    disabled={disabled}
                    onChange={(event) =>
                      update(answer.question_key, { remember: event.currentTarget.checked })
                    }
                  />
                ) : (
                  // No "remember" control at all: the spec forbids reusing
                  // these, so offering to store one would be offering a path
                  // the packet routes will refuse.
                  <p className="text-xs text-slate-600" data-testid="never-reuse-notice">
                    {t('answers.neverReuseNotice')}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <TextField
          label={t('answers.addLabel')}
          description={t('answers.addDescription')}
          value={newLabel}
          disabled={disabled}
          onChange={(event) => setNewLabel(event.currentTarget.value)}
          fieldClassName="grow"
        />
        <Button type="button" variant="secondary" disabled={disabled} onClick={addQuestion}>
          {t('answers.add')}
        </Button>
      </div>
    </section>
  );
}
