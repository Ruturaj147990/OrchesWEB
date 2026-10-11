function hasAffirmativeViolation(promptText, terms) {
  for (const term of terms) {
    const regex = new RegExp(`\\b${term}\\b`, "gi");
    let match;
    while ((match = regex.exec(promptText)) !== null) {
      const windowStart = Math.max(0, match.index - 60);
      const prefix = promptText.slice(windowStart, match.index).toLowerCase();
      const isNegated =
        prefix.includes("no ") ||
        prefix.includes("not ") ||
        prefix.includes("avoid ") ||
        prefix.includes("without ") ||
        prefix.includes("never ") ||
        prefix.includes("forbidden") ||
        prefix.includes("strict constraint") ||
        prefix.includes("do not");
      if (!isNegated) {
        return true;
      }
    }
  }
  return false;
}

const p1 = "STRICT CONSTRAINT: No ORMs (no Prisma, TypeORM, or Sequelize). Use raw SQLite queries.";
const p2 = "Use Prisma client with SQLite database.";
const p3 = "Strictly SQLite only; do not introduce external database servers like PostgreSQL or MongoDB.";
const p4 = "Use MongoDB database for persistence.";

console.log("p1 (constraint restatement, ORM):", hasAffirmativeViolation(p1, ["prisma", "typeorm", "sequelize"])); // Expect false
console.log("p2 (actual violation, ORM):", hasAffirmativeViolation(p2, ["prisma", "typeorm", "sequelize"])); // Expect true
console.log("p3 (constraint restatement, DB):", hasAffirmativeViolation(p3, ["postgresql", "mongodb", "mysql"])); // Expect false
console.log("p4 (actual violation, DB):", hasAffirmativeViolation(p4, ["postgresql", "mongodb", "mysql"])); // Expect true
