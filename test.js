const text = "Re: Polly Training : atkore-international-inc_530830484_DR_2.tiff";

// Extract the filename part after the colon
const fileWithExtension = text.split(":").pop().trim();

// Remove the extension
const fileName = fileWithExtension.replace(/\.[^/.]+$/, "");

console.log(fileName);

console.log(fileWithExtension);
