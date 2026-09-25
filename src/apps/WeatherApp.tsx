import {
  Droplets,
  Eye,
  Gauge,
  Navigation,
  RefreshCw,
  Sun,
  Sunrise,
  Sunset,
  Wind,
} from "lucide-react";
import { useMemo, useState } from "react";
import { usePolling } from "../lib/usePolling";
import {
  conditionFor,
  dayLabel,
  FORECAST_URL,
  hourLabel,
  readWeatherCache,
  round,
  uvLabel,
  WEATHER_REFRESH_MS,
  WeatherIcon,
  type WeatherForecast,
  windDirection,
  writeWeatherCache,
} from "./weather/forecast";
import { WeatherRadar } from "./weather/WeatherRadar";

export function WeatherApp() {
  const [forecast, setForecast] = useState<WeatherForecast | null>(() => readWeatherCache());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const refresh = usePolling(async (signal) => {
    try {
      const response = await fetch(FORECAST_URL, { signal });
      if (!response.ok) throw new Error(`Forecast returned ${response.status}`);
      const data = await response.json() as WeatherForecast;
      // A reply that lands after the app closed must not overwrite a newer cache.
      if (signal.aborted) return;
      setForecast(data);
      setError(false);
      writeWeatherCache(data);
    } catch {
      if (!signal.aborted) setError(true);
    }
  }, WEATHER_REFRESH_MS);

  // refresh() settles only after the run it asked for, even if a scheduled
  // run was already going, so the button stays disabled until then.
  const retry = () => {
    if (loading) return;
    setLoading(true);
    void refresh().finally(() => setLoading(false));
  };

  const currentHourIndex = useMemo(() => {
    if (!forecast) return 0;
    const currentTime = new Date(forecast.current.time).getTime();
    const firstAfterNow = forecast.hourly.time.findIndex((time) => new Date(time).getTime() > currentTime);
    if (firstAfterNow === -1) return Math.max(0, forecast.hourly.time.length - 1);
    return Math.max(0, firstAfterNow - 1);
  }, [forecast]);

  if (!forecast) {
    return (
      <section className="weather-app weather-app-loading">
        <RefreshCw />
        <strong>{error ? "Weather is temporarily unavailable" : "Loading Busselton weather"}</strong>
        {error && <button onClick={retry} disabled={loading}>Try again</button>}
      </section>
    );
  }

  const condition = conditionFor(forecast.current.weather_code);
  const CurrentIcon = condition.icon;
  const hourly = forecast.hourly.time.slice(currentHourIndex, currentHourIndex + 12).map((time, offset) => {
    const index = currentHourIndex + offset;
    return {
      time,
      temperature: forecast.hourly.temperature_2m[index],
      rainChance: forecast.hourly.precipitation_probability[index],
      rain: forecast.hourly.precipitation[index],
      code: forecast.hourly.weather_code[index],
    };
  });
  const detailIndex = currentHourIndex;
  const todayHigh = forecast.daily.temperature_2m_max[0];
  const todayLow = forecast.daily.temperature_2m_min[0];
  const nextRain = hourly.find(({ rainChance, rain }) => rainChance >= 30 || rain > 0);
  const rainSummary = nextRain
    ? `${round(nextRain.rainChance)}% chance of rain ${nextRain === hourly[0] ? "now" : `around ${hourLabel(nextRain.time, 1)}`}`
    : "No rain expected in the next 12 hours";
  const updatedAt = new Date(forecast.current.time).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });

  return (
    <section className={`weather-app weather-code-${forecast.current.weather_code}`}>
      <div className="weather-sky" aria-hidden="true"><i /><i /><i /></div>
      <div className="weather-scroll">
        <header className="weather-hero">
          <div>
            <p>Busselton</p>
            <div className="weather-current-temperature">{round(forecast.current.temperature_2m)}°</div>
            <strong>{condition.label}</strong>
            <span>Feels like {round(forecast.current.apparent_temperature)}° · H:{round(todayHigh)}° L:{round(todayLow)}°</span>
          </div>
          <CurrentIcon className="weather-current-icon" />
          <button
            className="weather-refresh"
            onClick={retry}
            disabled={loading}
            aria-label="Refresh weather"
          ><RefreshCw /></button>
        </header>

        {error && <div className="weather-stale-message">Could not refresh. Showing the last forecast saved on this display.</div>}

        <section className="weather-card weather-hourly-card">
          <div className="weather-card-heading">
            <div><span>Next 12 hours</span><strong>{rainSummary}</strong></div>
            <small>Updated {updatedAt}</small>
          </div>
          <div className="weather-hourly-row">
            {hourly.map((hour, index) => (
              <article key={hour.time}>
                <strong>{hourLabel(hour.time, index)}</strong>
                <WeatherIcon code={hour.code} />
                <span className={hour.rainChance >= 30 ? "has-rain" : undefined}>{round(hour.rainChance)}%</span>
                <b>{round(hour.temperature)}°</b>
              </article>
            ))}
          </div>
        </section>

        <WeatherRadar />

        <section className="weather-card weather-daily-card">
          <div className="weather-card-heading"><div><span>10-day forecast</span><strong>Daily outlook</strong></div></div>
          <div className="weather-daily-list">
            {forecast.daily.time.map((time, index) => (
              <article key={time}>
                <strong>{dayLabel(time, index)}</strong>
                <WeatherIcon code={forecast.daily.weather_code[index]} />
                <span>{round(forecast.daily.precipitation_probability_max[index])}%</span>
                <small>{round(forecast.daily.temperature_2m_min[index])}°</small>
                <i><b style={{ width: `${Math.max(12, Math.min(100, (forecast.daily.temperature_2m_max[index] - forecast.daily.temperature_2m_min[index]) * 7))}%` }} /></i>
                <strong>{round(forecast.daily.temperature_2m_max[index])}°</strong>
              </article>
            ))}
          </div>
        </section>

        <div className="weather-details-grid">
          <article className="weather-card"><div><Wind /><span>Wind</span></div><strong>{round(forecast.current.wind_speed_10m)} <small>km/h</small></strong><p>{windDirection(forecast.current.wind_direction_10m)} · Gusts {round(forecast.current.wind_gusts_10m)} km/h</p><Navigation style={{ transform: `rotate(${forecast.current.wind_direction_10m + 180}deg)` }} /></article>
          <article className="weather-card"><div><Droplets /><span>Humidity</span></div><strong>{round(forecast.current.relative_humidity_2m)}%</strong><p>Feels like {round(forecast.current.apparent_temperature)}°</p></article>
          <article className="weather-card"><div><Sun /><span>UV index</span></div><strong>{round(forecast.hourly.uv_index[detailIndex])}</strong><p>{uvLabel(forecast.hourly.uv_index[detailIndex])}</p><i className="uv-scale" /></article>
          <article className="weather-card"><div><Eye /><span>Visibility</span></div><strong>{round(forecast.hourly.visibility[detailIndex] / 1000)} <small>km</small></strong><p>{forecast.hourly.visibility[detailIndex] >= 10000 ? "Clear view" : "Reduced visibility"}</p></article>
          <article className="weather-card"><div><Gauge /><span>Pressure</span></div><strong>{round(forecast.current.pressure_msl)} <small>hPa</small></strong><p>Sea-level pressure</p></article>
          <article className="weather-card weather-sun-card"><div><Sunset /><span>Sunset</span></div><strong>{new Date(forecast.daily.sunset[0]).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}</strong><p><Sunrise /> Sunrise {new Date(forecast.daily.sunrise[0]).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}</p></article>
        </div>

        <footer className="weather-attribution">Forecast by Open-Meteo · Radar by RainViewer · Map by OpenStreetMap</footer>
      </div>
    </section>
  );
}
