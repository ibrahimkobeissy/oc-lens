export interface ChartSeries {
  key: string;
  label: string;
}

interface ChartDataTableProps {
  data: Array<Record<string, string | number>>;
  xKey: string;
  xLabel?: string;
  series: ChartSeries[];
}

/** Visually-hidden data table — the screen-reader-accessible fallback every chart primitive must expose alongside its SVG. */
export function ChartDataTable({ data, xKey, xLabel, series }: ChartDataTableProps) {
  return (
    <table>
      <caption>Underlying data for the chart above</caption>
      <thead>
        <tr>
          <th scope="col">{xLabel ?? xKey}</th>
          {series.map((s) => (
            <th key={s.key} scope="col">
              {s.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row, i) => (
          <tr key={i}>
            <td>{row[xKey]}</td>
            {series.map((s) => (
              <td key={s.key}>{row[s.key]}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
