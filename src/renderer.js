const catElement = document.getElementById("cat");
const stateLabel = document.getElementById("state-label");

window.virtualCat.onPetStateChanged((state) => {
  catElement.className = state;
  stateLabel.textContent = state;

  console.log("Pet state changed:", state);
});