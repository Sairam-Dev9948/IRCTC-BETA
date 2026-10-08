(() => {
  const ids = ["name", "age", "gender", "berth", "nationality"];
  const profileKey = "irctcProfiles";
  const legacyProfileKey = "irctcProfile";
  let savedProfiles = [];

  function setStatus(message, error = false) {
    const el = document.getElementById("status");
    el.textContent = message;
    el.style.color = error ? "#b00020" : "#176b2c";
  }

  function readProfile() {
    const profile = {};
    for (const id of ids) {
      profile[id] = document.getElementById(id).value.trim();
    }
    return profile;
  }

  function validateProfile(profile) {
    if (!profile.name || !profile.age || !profile.gender) {
      setStatus("Enter passenger name, age, and gender before adding this passenger.", true);
      return false;
    }
    const age = Number(profile.age);
    if (!Number.isInteger(age) || age < 1 || age > 120) {
      setStatus("Enter a valid passenger age from 1 to 120.", true);
      return false;
    }
    return true;
  }

  function clearForm() {
    for (const id of ids) {
      document.getElementById(id).value = id === "nationality" ? "India" : "";
    }
  }

  function renderProfiles() {
    const list = document.getElementById("profiles");
    list.replaceChildren();
    document.getElementById("fill").disabled = savedProfiles.length === 0;

    savedProfiles.forEach((profile, index) => {
      const item = document.createElement("li");
      const details = document.createElement("span");
      details.className = "profile-details";
      details.textContent = `${profile.name}, ${profile.age} · ${profile.gender} · ${profile.berth || "No Preference"}`;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-profile";
      remove.dataset.profileId = profile.id;
      remove.setAttribute("aria-label", `Remove ${profile.name}`);
      remove.textContent = "Remove";

      item.append(details, remove);
      list.append(item);
    });
  }

  async function persistProfiles() {
    const legacyProfile = savedProfiles[0]
      ? Object.fromEntries(ids.map(id => [id, savedProfiles[0][id] || ""]))
      : null;
    await chrome.storage.local.set({
      [profileKey]: savedProfiles,
      [legacyProfileKey]: legacyProfile
    });
  }

  async function loadProfiles() {
    try {
      const stored = await chrome.storage.local.get([profileKey, legacyProfileKey]);
      if (Array.isArray(stored[profileKey])) {
        savedProfiles = stored[profileKey]
          .filter(profile => profile && typeof profile === "object")
          .map((profile, index) => ({
            id: String(profile.id || `passenger-${index}-${Date.now()}`),
            ...Object.fromEntries(ids.map(id => [id, String(profile[id] ?? "")]))
          }));
      } else if (stored[legacyProfileKey] && typeof stored[legacyProfileKey] === "object") {
        savedProfiles = [{
          id: `passenger-${Date.now()}`,
          ...Object.fromEntries(ids.map(id => [id, String(stored[legacyProfileKey][id] ?? "")]))
        }];
        await persistProfiles();
      }
      renderProfiles();
    } catch (error) {
      console.error("Could not load saved passenger profiles:", error);
      setStatus("Could not load saved passengers. Check extension storage permissions.", true);
    }
  }

  const profilesReady = loadProfiles();

  async function saveProfile() {
    await profilesReady;
    const profile = readProfile();
    if (!validateProfile(profile)) return;

    try {
      savedProfiles.push({
        id: crypto.randomUUID(),
        ...profile,
        berth: profile.berth || "No Preference",
        nationality: profile.nationality || "India"
      });
      await persistProfiles();
      renderProfiles();
      setStatus(`Saved ${savedProfiles.length} passenger${savedProfiles.length === 1 ? "" : "s"}. They will be added in this order.`);
      clearForm();
    } catch (error) {
      savedProfiles.pop();
      console.error("Could not save passenger profile:", error);
      setStatus("Could not save passenger. Check extension storage permissions.", true);
    }
  }

  async function removeProfile(event) {
    const button = event.target.closest("button[data-profile-id]");
    if (!button) return;
    await profilesReady;
    const index = savedProfiles.findIndex(profile => profile.id === button.dataset.profileId);
    if (index < 0) return;

    const [removed] = savedProfiles.splice(index, 1);
    try {
      await persistProfiles();
      renderProfiles();
      setStatus(`Removed ${removed.name} from saved passengers.`);
    } catch (error) {
      savedProfiles.splice(index, 0, removed);
      console.error("Could not remove passenger profile:", error);
      setStatus("Could not remove passenger. Check extension storage permissions.", true);
    }
  }

  async function fillPage() {
    await profilesReady;
    if (!savedProfiles.length) {
      setStatus("Add at least one passenger to the saved list first.", true);
      return;
    }

    const fillButton = document.getElementById("fill");
    fillButton.disabled = true;
    setStatus(`Adding ${savedProfiles.length} passenger${savedProfiles.length === 1 ? "" : "s"}...`);

    try {
      await persistProfiles();
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (!tab?.id) {
        setStatus("Active tab not found.", true);
        return;
      }

      let pageUrl;
      try {
        pageUrl = new URL(tab.url);
      } catch {
        setStatus("Could not read the active tab URL. Open an IRCTC booking page and try again.", true);
        return;
      }

      if (!["beta.irctc.co.in", "www.irctc.co.in"].includes(pageUrl.hostname)) {
        setStatus("Open an IRCTC booking page (beta.irctc.co.in or www.irctc.co.in) and try again.", true);
        return;
      }

      const message = { type: "IRCTC_FILL", profiles: savedProfiles };
      let response;
      try {
        response = await chrome.tabs.sendMessage(tab.id, message);
      } catch (error) {
        if (!/receiving end does not exist|could not establish connection/i.test(error.message || "")) {
          throw error;
        }

        setStatus("Connecting to the booking page...");
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"]
        });
        response = await chrome.tabs.sendMessage(tab.id, message);
      }

      setStatus(response?.message || "The page did not return an autofill result.", response?.ok !== true);
    } catch (error) {
      console.error("Passenger autofill failed:", error);
      setStatus(`Autofill failed: ${error.message || "Unknown extension error."}`, true);
    } finally {
      fillButton.disabled = savedProfiles.length === 0;
    }
  }

  async function clearProfiles() {
    await profilesReady;
    const previous = savedProfiles;
    savedProfiles = [];
    try {
      await chrome.storage.local.remove([profileKey, legacyProfileKey]);
      renderProfiles();
      clearForm();
      setStatus("All saved passengers cleared.");
    } catch (error) {
      savedProfiles = previous;
      renderProfiles();
      console.error("Could not clear passenger profiles:", error);
      setStatus("Could not clear saved passengers.", true);
    }
  }

  document.getElementById("save").addEventListener("click", saveProfile);
  document.getElementById("profiles").addEventListener("click", removeProfile);
  document.getElementById("fill").addEventListener("click", fillPage);
  document.getElementById("clear").addEventListener("click", clearProfiles);
})();
