import { parseSqlInterval } from '@cubejs-backend/shared';
import { PostgresQuery } from './PostgresQuery';

export class RedshiftQuery extends PostgresQuery {
  public seriesSql(timeDimension) {
    const values = timeDimension.timeSeries().map(
      ([from, to]) => `select '${from}' f, '${to}' t`
    ).join(' UNION ALL ');
    return `SELECT dates.f::timestamp date_from, dates.t::timestamp date_to FROM (${values}) dates`;
  }

  public nowTimestampSql() {
    return 'GETDATE()';
  }

  /**
   * Redshift doesn't support Interval values with month or year parts (as Postgres does)
   * so we need to make date math on our own.
   */
  public override subtractInterval(date: string, interval: string): string {
    const intervalParsed = parseSqlInterval(interval);
    let result = date;

    for (const [datePart, intervalValue] of Object.entries(intervalParsed)) {
      result = `DATEADD(${datePart}, -${intervalValue}, ${result})`;
    }

    return result;
  }

  /**
   * Redshift doesn't support Interval values with month or year parts (as Postgres does)
   * so we need to make date math on our own.
   */
  public override addInterval(date: string, interval: string): string {
    const intervalParsed = parseSqlInterval(interval);
    let result = date;

    for (const [datePart, intervalValue] of Object.entries(intervalParsed)) {
      result = `DATEADD(${datePart}, ${intervalValue}, ${result})`;
    }

    return result;
  }

  /**
   * Redshift doesn't support Interval values with month or year parts (as Postgres does)
   * so we need to make date math on our own.
   */
  public override dateBin(interval: string, source: string, origin: string): string {
    const intervalParsed = parseSqlInterval(interval);

    if ((intervalParsed.year || intervalParsed.month || intervalParsed.quarter) &&
        (intervalParsed.week || intervalParsed.day || intervalParsed.hour || intervalParsed.minute || intervalParsed.second)) {
      throw new Error(`Complex intervals like "${interval}" are not supported. Please use Year to Month or Day to second intervals`);
    }

    if (intervalParsed.year || intervalParsed.month || intervalParsed.quarter) {
      let totalMonths = 0;

      if (intervalParsed.year) {
        totalMonths += intervalParsed.year * 12;
      }

      if (intervalParsed.quarter) {
        totalMonths += intervalParsed.quarter * 3;
      }

      if (intervalParsed.month) {
        totalMonths += intervalParsed.month;
      }

      return `DATEADD(
      month,
      (FLOOR(DATEDIFF(month, ${this.dateTimeCast(`'${origin}'`)}, ${source}) / ${totalMonths}) * ${totalMonths})::int,
      ${this.dateTimeCast(`'${origin}'`)}
    )`;
    }

    // For days and lower intervals - we can reuse Postgres version
    return super.dateBin(interval, source, origin);
  }

  public sqlTemplates() {
    const templates = super.sqlTemplates();
    templates.functions.DLOG10 = 'LOG(10, {{ args_concat }})';
    templates.functions.DATEDIFF = 'DATEDIFF({{ date_part }}, {{ args[1] }}, {{ args[2] }})';
    delete templates.functions.COVAR_POP;
    delete templates.functions.COVAR_SAMP;
    delete templates.window_frame_types.range;
    delete templates.window_frame_types.groups;
    templates.types.binary = 'VARBINARY';
    return templates;
  }

  /**
   * Override subtractInterval to handle month/year intervals in Redshift.
   * Redshift doesn't support INTERVAL syntax for month/year units (e.g., 'INTERVAL '1 month'')
   * Instead, we use DATEADD function which is the Redshift equivalent.
   * 
   * Examples:
   * - "2 months" -> DATEADD(month, -2, date)
   * - "-2 months" -> DATEADD(month, 2, date)  // subtracting negative = adding
   * - "1 year" -> DATEADD(year, -1, date)
   * - "-1 year" -> DATEADD(year, 1, date)
   */
  public subtractInterval(date: string, interval: string): string {
    const match = interval.match(/^(-?\d+)\s*(month|months|year|years)$/);
    if (match) {
      const [, amount, unit] = match;
      // Convert plural to singular for DATEADD
      const singularUnit = unit.replace(/s$/, '');
      // If amount is negative, we're subtracting a negative, so we should add
      const finalAmount = amount.startsWith('-') ? amount.substring(1) : `-${amount}`;
      return `DATEADD(${singularUnit}, ${finalAmount}, ${date})`;
    }
    return super.subtractInterval(date, interval);
  }

  /**
   * Override addInterval to handle month/year intervals in Redshift.
   * Similar to subtractInterval, but for adding time periods.
   * Uses DATEADD function which is Redshift's way of handling date arithmetic.
   * 
   * Examples:
   * - "2 months" -> DATEADD(month, 2, date)
   * - "-2 months" -> DATEADD(month, -2, date)
   * - "1 year" -> DATEADD(year, 1, date)
   * - "-1 year" -> DATEADD(year, -1, date)
   */
  public addInterval(date: string, interval: string): string {
    const match = interval.match(/^(-?\d+)\s*(month|months|year|years)$/);
    if (match) {
      const [, amount, unit] = match;
      // Convert plural to singular for DATEADD
      const singularUnit = unit.replace(/s$/, '');
      return `DATEADD(${singularUnit}, ${amount}, ${date})`;
    }
    return super.addInterval(date, interval);
  }
}

