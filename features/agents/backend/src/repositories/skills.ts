import { prisma, Prisma } from "@internal/db";

export type SkillRow = Prisma.SkillGetPayload<true>;

export interface SkillRepository {
  list(): Promise<SkillRow[]>;
  findById(id: string): Promise<SkillRow | null>;
  findByIds(ids: string[]): Promise<SkillRow[]>;
  create(data: Prisma.SkillUncheckedCreateInput): Promise<SkillRow>;
  update(id: string, data: Prisma.SkillUncheckedUpdateInput): Promise<SkillRow>;
  delete(id: string): Promise<void>;
}

export const skillRepository: SkillRepository = {
  list() {
    return prisma.skill.findMany({ orderBy: [{ builtin: "desc" }, { label: "asc" }] });
  },
  findById(id) {
    return prisma.skill.findUnique({ where: { id } });
  },
  findByIds(ids) {
    return prisma.skill.findMany({ where: { id: { in: ids } } });
  },
  create(data) {
    return prisma.skill.create({ data });
  },
  update(id, data) {
    return prisma.skill.update({ where: { id }, data });
  },
  async delete(id) {
    await prisma.skill.delete({ where: { id } });
  },
};
