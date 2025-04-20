import { getStudents } from "@/actions/student";
import { getStudent } from "@/actions/student/read";
import { getStudentsCount } from "@/actions/count";
import { StudentWithPreference } from "@/schemas/student.schema";
import { useQuery } from "@tanstack/react-query";
import { Grade, Student, StudentPreference } from "@prisma/client";

export function useStudentsCount() {
    return useQuery({
        queryKey: ["students", "count"],
        queryFn: () => getStudentsCount(),
    });
}

export function useStudents(page: number = 1, pageSize: number = 15) {
    return useQuery({
        queryKey: ["students", page, pageSize],
        queryFn: () => getStudents({ page, pageSize }) as Promise<(Student & { grade: Grade | null, preference: StudentPreference | null })[]>,
    });
}

export function useStudent(studentId: string) {
    return useQuery({
        queryKey: ["students", studentId],
        queryFn: () => getStudent(studentId) as Promise<StudentWithPreference>,
        enabled: !!studentId
    });
}