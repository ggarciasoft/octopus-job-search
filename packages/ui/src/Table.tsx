import type { ReactNode } from 'react';
import { cn } from './cn';

export interface TableColumn<Row> {
  readonly key: string;
  readonly header: ReactNode;
  readonly cell: (row: Row) => ReactNode;
  readonly className?: string;
  /** Marks the column whose cell identifies the row (rendered as `th`). */
  readonly rowHeader?: boolean;
}

export interface TableProps<Row> {
  /** Required: a data table without a caption is unnavigable by screen reader. */
  readonly caption: ReactNode;
  readonly columns: readonly TableColumn<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row, index: number) => string;
  /** Rendered in place of rows; the caller supplies an honest empty state. */
  readonly empty?: ReactNode;
  readonly className?: string;
  readonly captionHidden?: boolean;
}

export function Table<Row>({
  caption,
  columns,
  rows,
  rowKey,
  empty,
  className,
  captionHidden = false,
}: TableProps<Row>) {
  if (rows.length === 0 && empty !== undefined) {
    return <>{empty}</>;
  }

  return (
    <table className={cn('w-full border-collapse text-left text-sm', className)}>
      <caption
        className={cn(
          'text-sm text-slate-600',
          captionHidden
            ? 'absolute h-px w-px overflow-hidden whitespace-nowrap border-0 p-0 -m-px'
            : 'mb-2',
        )}
      >
        {caption}
      </caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              className={cn(
                'border-b border-slate-300 px-3 py-2 font-semibold text-slate-800',
                column.className,
              )}
            >
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={rowKey(row, index)} className="align-top">
            {columns.map((column) =>
              column.rowHeader === true ? (
                <th
                  key={column.key}
                  scope="row"
                  className={cn(
                    'border-b border-slate-200 px-3 py-2 font-medium text-slate-900',
                    column.className,
                  )}
                >
                  {column.cell(row)}
                </th>
              ) : (
                <td
                  key={column.key}
                  className={cn('border-b border-slate-200 px-3 py-2', column.className)}
                >
                  {column.cell(row)}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
