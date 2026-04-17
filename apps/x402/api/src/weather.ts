const USER_AGENT = "weather-x402/0.1";

export interface GeocodingResult {
  lat: number;
  lon: number;
  displayName: string;
}

export interface WeatherResult {
  location: string;
  temperature: number;
  unit: string;
  shortForecast: string;
  detailedForecast: string;
  windSpeed: string;
  windDirection: string;
}

export async function geocodeCity(city: string): Promise<GeocodingResult> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`;

  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(
      `Geocoding request failed: ${response.status} ${response.statusText}`,
    );
  }

  const results = (await response.json()) as Array<{
    lat: string;
    lon: string;
    display_name: string;
  }>;

  if (results.length === 0) {
    throw new Error(
      `Could not find coordinates for "${city}". Please check the city name and try again.`,
    );
  }

  return {
    lat: parseFloat(results[0].lat),
    lon: parseFloat(results[0].lon),
    displayName: results[0].display_name,
  };
}

export async function getWeather(
  lat: number,
  lon: number,
): Promise<WeatherResult> {
  const pointsUrl = `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`;

  const pointsResponse = await fetch(pointsUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/geo+json",
    },
  });

  if (!pointsResponse.ok) {
    if (pointsResponse.status === 404) {
      throw new Error(
        "The weather.gov API only covers US locations. The coordinates provided are outside the supported area.",
      );
    }
    throw new Error(
      `weather.gov points request failed: ${pointsResponse.status} ${pointsResponse.statusText}`,
    );
  }

  const pointsData = (await pointsResponse.json()) as {
    properties: {
      forecast: string;
      relativeLocation: {
        properties: { city: string; state: string };
      };
    };
  };

  const forecastUrl = pointsData.properties.forecast;
  const { city, state } = pointsData.properties.relativeLocation.properties;

  const forecastResponse = await fetch(forecastUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/geo+json",
    },
  });

  if (!forecastResponse.ok) {
    throw new Error(
      `weather.gov forecast request failed: ${forecastResponse.status} ${forecastResponse.statusText}`,
    );
  }

  const forecastData = (await forecastResponse.json()) as {
    properties: {
      periods: Array<{
        temperature: number;
        temperatureUnit: string;
        shortForecast: string;
        detailedForecast: string;
        windSpeed: string;
        windDirection: string;
      }>;
    };
  };

  const current = forecastData.properties.periods[0];

  return {
    location: `${city}, ${state}`,
    temperature: current.temperature,
    unit: current.temperatureUnit,
    shortForecast: current.shortForecast,
    detailedForecast: current.detailedForecast,
    windSpeed: current.windSpeed,
    windDirection: current.windDirection,
  };
}
