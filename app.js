const menuToggle = document.querySelector("#menu-toggle");
const primaryMenu = document.querySelector("#primary-menu");
const menuLinks = [...primaryMenu.querySelectorAll("a")];

function closeMenu() {
  primaryMenu.classList.remove("open");
  menuToggle.setAttribute("aria-expanded", "false");
  menuToggle.setAttribute("aria-label", "Open navigation menu");
}

menuToggle.addEventListener("click", () => {
  const isOpen = primaryMenu.classList.toggle("open");

  menuToggle.setAttribute("aria-expanded", String(isOpen));
  menuToggle.setAttribute(
    "aria-label",
    isOpen ? "Close navigation menu" : "Open navigation menu"
  );
});

menuLinks.forEach((link) => {
  link.addEventListener("click", closeMenu);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeMenu();
    menuToggle.focus();
  }
});

window.addEventListener("resize", () => {
  if (window.innerWidth > 760) {
    closeMenu();


    async function loadWeather() {
  const weatherContent = document.querySelector("#weather-content");

  if (!weatherContent) return;

  try {
    // Approximate coordinates for Gatesville, Texas.
    const pointResponse = await fetch(
      "https://api.weather.gov/points/31.4352,-97.7439"
    );

    if (!pointResponse.ok) {
      throw new Error("Could not locate the weather forecast.");
    }

    const pointData = await pointResponse.json();
    const forecastUrl = pointData.properties.forecast;

    const forecastResponse = await fetch(forecastUrl);

    if (!forecastResponse.ok) {
      throw new Error("Could not retrieve the forecast.");
    }

    const forecastData = await forecastResponse.json();
    const periods = forecastData.properties.periods;
    const current = periods[0];
    const next = periods[1];

    weatherContent.innerHTML = `
      <div class="weather-current">
        <div class="weather-temperature">
          ${current.temperature}&deg;${current.temperatureUnit}
        </div>

        <div class="weather-details">
          <strong>${current.name}: ${current.shortForecast}</strong>
          <p>Wind: ${current.windSpeed} ${current.windDirection}</p>
          <p>${current.detailedForecast}</p>
          ${
            next
              ? `<p><strong>${next.name}:</strong> ${next.temperature}&deg;${next.temperatureUnit}, ${next.shortForecast}</p>`
              : ""
          }
        </div>
      </div>
    `;
  } catch (error) {
    console.error(error);

    weatherContent.innerHTML = `
      <p>
        Local weather is temporarily unavailable.
        <a href="https://www.weather.gov/" target="_blank" rel="noopener">
          View the National Weather Service
        </a>
      </p>
    `;
  }
}

loadWeather();
  }
});

document.querySelector("#year").textContent = new Date().getFullYear();
