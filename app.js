const RSS_WORKER_URL = "https://coryell-county-rss.YOUR-SUBDOMAIN.workers.dev";

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
  }
});

function setupHeroVideo() {
  const video = document.querySelector("#hero-video");
  const toggle = document.querySelector("#video-toggle");

  if (!video || !toggle) return;

  function setToggleState(isPlaying) {
    toggle.setAttribute(
      "aria-label",
      isPlaying ? "Pause background video" : "Play background video"
    );
    toggle.querySelector("span").textContent = isPlaying ? "⏸" : "▶";
  }

  toggle.addEventListener("click", () => {
    if (video.paused) {
      video.play();
      setToggleState(true);
    } else {
      video.pause();
      setToggleState(false);
    }
  });

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  if (reduceMotion.matches) {
    video.pause();
    setToggleState(false);
  }
}

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
        <a href="https://www.weather.gov/" target="_blank" rel="noopener noreferrer">
          View the National Weather Service
        </a>
      </p>
    `;
  }
}

async function loadTexasHeadlines() {
  const list = document.querySelector("#rss-news-list");

  if (!list) return;

  try {
    const response = await fetch(RSS_WORKER_URL);

    if (!response.ok) {
      throw new Error("Headline service unavailable.");
    }

    const data = await response.json();
    const stories = Array.isArray(data.stories) ? data.stories : [];

    if (!stories.length) {
      list.innerHTML = "<p>No headlines available right now.</p>";
      return;
    }

    list.innerHTML = "";

    stories.forEach((story) => {
      const article = document.createElement("article");

      const source = document.createElement("span");
      source.textContent = story.source || "Texas News";

      const heading = document.createElement("h3");
      const link = document.createElement("a");
      link.href = story.link;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = story.title;
      heading.appendChild(link);

      article.append(source, heading);

      if (story.pubDate) {
        const date = document.createElement("p");
        date.textContent = new Date(story.pubDate).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        article.appendChild(date);
      }

      list.appendChild(article);
    });
  } catch (error) {
    console.error(error);
    list.innerHTML = "<p>Texas headlines are temporarily unavailable.</p>";
  }
}

setupHeroVideo();
loadWeather();
loadTexasHeadlines();

document.querySelector("#year").textContent = new Date().getFullYear();
