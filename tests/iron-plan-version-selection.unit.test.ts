import { describe, expect, it } from "vitest";
import { resolveIronPublishedPlanVersion as choose } from "@/application/billing/iron-plan-version-selection";
const rows=[
  {plan_code:"IRON_START",version:1},
  {plan_code:"IRON_START",version:2},
  {plan_code:"IRON_GROWTH",version:1},
];
describe("FM Command governed IRON commercial plan-version routing",()=>{
  it("uses sole published version without extra operator config",()=>{
    expect(choose(rows,"IRON_GROWTH")).toBe(1);
  });
  it("fails closed when old and new published versions coexist without commercial binding",()=>{
    expect(()=>choose(rows,"IRON_START")).toThrow("iron.plan_version_not_unique");
  });
  it("requires exact, published and explicitly approved version",()=>{
    expect(choose(rows,"IRON_START",JSON.stringify({IRON_START:2}))).toBe(2);
    expect(choose(rows,"IRON_START",JSON.stringify({IRON_START:1}))).toBe(1);
    expect(()=>choose(rows,"IRON_START",JSON.stringify({IRON_START:3}))).toThrow("iron.plan_version_not_unique");
    expect(()=>choose(rows,"IRON_START",JSON.stringify({IRON_OTHER:1}))).toThrow("iron.plan_version_not_unique");
  });
  it("rejects invalid mapping types, versions and duplicate catalog rows",()=>{
    for(const invalid of ["[]",'{"IRON_START":"2"}','{"IRON_START":0}',"{broken}"]){
      expect(()=>choose(rows,"IRON_START",invalid)).toThrow("iron.plan_version_mapping_invalid");
    }
    expect(()=>choose([{plan_code:"IRON_START",version:2},{plan_code:"IRON_START",version:2}],"IRON_START"))
      .toThrow("iron.plan_version_not_unique");
    expect(()=>choose(rows,"BAD/TENANT")).toThrow("iron.plan_version_catalog_invalid");
  });
});
