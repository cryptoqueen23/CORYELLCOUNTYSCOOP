const RSS_WORKER_URL = "https://coryell-county-rss.truewolfflix777.workers.dev";

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
    const { forecast: forecastUrl, observationStations: stationsUrl } = pointData.properties;

    const [forecastResponse, stationsResponse] = await Promise.all([
      fetch(forecastUrl),
      fetch(stationsUrl),
    ]);

    if (!forecastResponse.ok) {
      throw new Error("Could not retrieve the forecast.");
    }

    const forecastData = await forecastResponse.json();
    const periods = forecastData.properties.periods;
    const upcoming = periods[0];
    const next = periods[1];

    // The forecast endpoint only gives upcoming periods (e.g. "Tonight"), not
    // the current temperature. Pull that from the nearest station's latest
    // real-time observation instead, so the headline number matches reality.
    let currentTemperature = upcoming.temperature;
    let currentUnit = upcoming.temperatureUnit;
    let currentConditions = upcoming.shortForecast;

    if (stationsResponse.ok) {
      const stationsData = await stationsResponse.json();
      const stationId = stationsData.features?.[0]?.properties?.stationIdentifier;

      if (stationId) {
        const obsResponse = await fetch(
          `https://api.weather.gov/stations/${stationId}/observations/latest`
        );

        if (obsResponse.ok) {
          const obsData = await obsResponse.json();
          const tempC = obsData.properties.temperature?.value;

          if (typeof tempC === "number") {
            currentTemperature = Math.round((tempC * 9) / 5 + 32);
            currentUnit = "F";
          }

          if (obsData.properties.textDescription) {
            currentConditions = obsData.properties.textDescription;
          }
        }
      }
    }

    weatherContent.innerHTML = `
      <div class="weather-current">
        <div class="weather-temperature">
          ${currentTemperature}&deg;${currentUnit}
        </div>

        <div class="weather-details">
          <strong>Right now: ${currentConditions}</strong>
          <p>Wind: ${upcoming.windSpeed} ${upcoming.windDirection}</p>
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

function renderStoryList(list, stories, emptyMessage) {
  if (!stories.length) {
    list.innerHTML = `<p>${emptyMessage}</p>`;
    return;
  }

  list.innerHTML = "";

  stories.forEach((story) => {
    const article = document.createElement("article");

    const source = document.createElement("span");
    source.textContent = `Source: ${story.source || "Texas News"}`;

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
}

function renderBreakingNews(stories) {
  const breakingText = document.querySelector("#breaking-news-text");

  if (!breakingText) return;

  if (!stories.length) {
    breakingText.textContent = "Coryell County headlines will appear here from your RSS feeds.";
    return;
  }

  const topStory = stories[0];

  breakingText.innerHTML = "";
  const link = document.createElement("a");
  link.href = topStory.link;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = topStory.title;

  const source = document.createElement("span");
  source.className = "breaking-source";
  source.textContent = ` — Source: ${topStory.source || "Texas News"}`;

  breakingText.append(link, source);
}

async function loadHeadlines() {
  const headlinesList = document.querySelector("#rss-news-list");
  const electionList = document.querySelector("#election-watch-list");
  const breakingText = document.querySelector("#breaking-news-text");

  if (!headlinesList && !electionList && !breakingText) return;

  try {
    const response = await fetch(RSS_WORKER_URL);

    if (!response.ok) {
      throw new Error("Headline service unavailable.");
    }

    const data = await response.json();
    const stories = Array.isArray(data.stories) ? data.stories : [];

    if (headlinesList) {
      renderStoryList(headlinesList, stories, "No headlines available right now.");
    }

    if (breakingText) {
      renderBreakingNews(stories);
    }

    if (electionList) {
      const electionStories = Array.isArray(data.electionStories) ? data.electionStories : [];
      renderStoryList(electionList, electionStories, "No election coverage available right now.");
    }
  } catch (error) {
    console.error(error);
    if (headlinesList) headlinesList.innerHTML = "<p>Texas headlines are temporarily unavailable.</p>";
    if (electionList) electionList.innerHTML = "<p>Election coverage is temporarily unavailable.</p>";
  }
}

setupHeroVideo();
loadWeather();
loadHeadlines();

document.querySelector("#year").textContent = new Date().getFullYear();
