export interface TimeSeriesPoint {
  period: string;
  value: number;
}

export interface ForecastResult {
  method: string;
  history: TimeSeriesPoint[];
  forecast: TimeSeriesPoint[];
  slope?: number;
  confidenceNote: string;
  insufficientData?: boolean;
}

const MIN_POINTS = 7;

export const linearRegressionForecast = (
  points: TimeSeriesPoint[],
  forecastDays: number,
): ForecastResult => {
  if (points.length < MIN_POINTS) {
    return {
      method: "linear_regression",
      history: points,
      forecast: [],
      confidenceNote: `Insufficient data: need at least ${MIN_POINTS} data points, got ${points.length}.`,
      insufficientData: true,
    };
  }

  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  points.forEach((point, index) => {
    sumX += index;
    sumY += point.value;
    sumXY += index * point.value;
    sumX2 += index * index;
  });

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  const forecast: TimeSeriesPoint[] = [];

  for (let i = 1; i <= forecastDays; i++) {
    const projectedValue = Math.max(0, intercept + slope * (n - 1 + i));
    forecast.push({
      period: `forecast+${i}`,
      value: Math.round(projectedValue * 100) / 100,
    });
  }

  const confidenceNote =
    points.length < 14
      ? "Low confidence: less than 14 days of history."
      : "Moderate confidence based on linear trend.";

  return {
    method: "linear_regression",
    history: points,
    forecast,
    slope: Math.round(slope * 100) / 100,
    confidenceNote,
  };
};

export const movingAverageForecast = (
  points: TimeSeriesPoint[],
  forecastDays: number,
  windowSize = 7,
): ForecastResult => {
  if (points.length < MIN_POINTS) {
    return {
      method: `moving_average_${windowSize}`,
      history: points,
      forecast: [],
      confidenceNote: `Insufficient data: need at least ${MIN_POINTS} data points.`,
      insufficientData: true,
    };
  }

  const window = points.slice(-windowSize);
  const avg = window.reduce((sum, p) => sum + p.value, 0) / window.length;

  const forecast: TimeSeriesPoint[] = Array.from({length: forecastDays}, (_, i) => ({
    period: `forecast+${i + 1}`,
    value: Math.round(avg * 100) / 100,
  }));

  return {
    method: `moving_average_${windowSize}`,
    history: points,
    forecast,
    confidenceNote: `Based on ${windowSize}-period moving average.`,
  };
};

export const exponentialSmoothingForecast = (
  points: TimeSeriesPoint[],
  forecastDays: number,
  alpha = 0.3,
): ForecastResult => {
  if (points.length < MIN_POINTS) {
    return {
      method: "exponential_smoothing",
      history: points,
      forecast: [],
      confidenceNote: `Insufficient data: need at least ${MIN_POINTS} data points.`,
      insufficientData: true,
    };
  }

  let smoothed = points[0]?.value ?? 0;
  points.forEach((point, index) => {
    if (index === 0) {
      smoothed = point.value;
    } else {
      smoothed = alpha * point.value + (1 - alpha) * smoothed;
    }
  });

  const forecast: TimeSeriesPoint[] = Array.from({length: forecastDays}, (_, i) => ({
    period: `forecast+${i + 1}`,
    value: Math.round(smoothed * 100) / 100,
  }));

  return {
    method: "exponential_smoothing",
    history: points,
    forecast,
    confidenceNote: `Exponential smoothing (alpha=${alpha}), weighted toward recent values.`,
  };
};

export const forecastFromPoints = (
  points: TimeSeriesPoint[],
  forecastDays: number,
  method: "linear_regression" | "moving_average" | "exponential_smoothing" = "linear_regression",
): ForecastResult => {
  switch (method) {
    case "moving_average":
      return movingAverageForecast(points, forecastDays);
    case "exponential_smoothing":
      return exponentialSmoothingForecast(points, forecastDays);
    default:
      return linearRegressionForecast(points, forecastDays);
  }
};
