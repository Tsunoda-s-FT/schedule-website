import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createNotification } from '@/lib/notification/notification-service';
import { runNotificationWorker } from '@/lib/notification/notification-worker';
import { addDays, format, startOfDay } from 'date-fns';
import { toZonedTime, formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { replaceTemplateVariables, DEFAULT_CLASS_LIST_ITEM_TEMPLATE, DEFAULT_CLASS_LIST_SUMMARY_TEMPLATE } from '@/lib/line/message-templates';
import { withRole } from '@/lib/auth';

const TIMEZONE = 'Asia/Tokyo';

/**
 * Process notifications with optional reset capability
 */
async function processNotifications(reset: boolean = false, templateId?: string) {
  const startTime = Date.now();
  const now = new Date();
  const nowJST = toZonedTime(now, TIMEZONE);

  console.log('🚀 === UNIFIED NOTIFICATION PROCESSING STARTED ===');
  console.log('Current time (UTC):', now.toISOString());
  console.log('Current time (JST):', formatInTimeZone(now, TIMEZONE, 'yyyy-MM-dd HH:mm:ss zzz'));
  console.log('Reset mode:', reset);
  console.log('Template ID:', templateId || 'All templates');
  console.log('Environment:', process.env.NODE_ENV);

  const results = {
    phase: 'starting',
    notificationsCreated: 0,
    notificationsSent: 0,
    notificationsFailed: 0,
    errors: [] as string[],
    executionTimeMs: 0,
    deletedNotifications: 0
  };

  try {
    // PHASE 1: Create notifications
    console.log('\n📋 PHASE 1: Creating notifications...');
    results.phase = 'creating';

    const activeTemplates = await prisma.lineMessageTemplate.findMany({
      where: {
        templateType: 'before_class',
        isActive: true,
        branchId: null,
        ...(templateId && { id: templateId })
      },
      select: {
        id: true,
        name: true,
        timingType: true,
        timingValue: true,
        timingHour: true,
        timingMinute: true,
        branchId: true,
        content: true,
        classListItemTemplate: true,
        classListSummaryTemplate: true,
        branch: {
          select: {
            name: true
          }
        }
      }
    });

    console.log(`Found ${activeTemplates.length} active templates`);

    for (const template of activeTemplates) {
      try {
        console.log(`\n🔄 Processing template: ${template.name}`);
        console.log(`  Scheduled for: ${template.timingHour}:${String(template.timingMinute ?? 0).padStart(2, '0')}`);

        // Check if it's within the time window to send
        // We use a 15-minute window to account for cron job intervals
        const currentHour = nowJST.getHours();
        const currentMinute = nowJST.getMinutes();
        const templateHour = template.timingHour;
        const templateMinute = template.timingMinute ?? 0;

        // Calculate if we're within 15 minutes after the scheduled time
        const currentTotalMinutes = currentHour * 60 + currentMinute;
        const templateTotalMinutes = templateHour * 60 + templateMinute;
        const minutesDiff = currentTotalMinutes - templateTotalMinutes;

        if (!reset && (minutesDiff < 0 || minutesDiff >= 15)) {
          console.log(`  ⏰ Not in time window. Current: ${currentHour}:${String(currentMinute).padStart(2, '0')}, Scheduled: ${templateHour}:${String(templateMinute).padStart(2, '0')}`);
          console.log(`  Minutes difference: ${minutesDiff} (must be 0-14)`);
          continue;
        }

        console.log(`  ✅ Within time window (${minutesDiff} minutes after scheduled time)`);

        // Calculate target date
        const targetDate = startOfDay(addDays(nowJST, template.timingValue));
        const targetDateString = format(targetDate, 'yyyy-MM-dd');

        // Handle reset mode - delete existing PENDING notifications for this template
        if (reset) {
          const notificationType = template.timingValue === 0 ? 'DAILY_SUMMARY_SAMEDAY' :
                                 template.timingValue === 1 ? 'DAILY_SUMMARY_1D' :
                                 `DAILY_SUMMARY_${template.timingValue}D`;
          
          const deleted = await prisma.notification.deleteMany({
            where: {
              templateId: template.id,
              notificationType,
              targetDate,
              status: 'PENDING'
            }
          });
          
          if (deleted.count > 0) {
            console.log(`  🗑️ Reset: Deleted ${deleted.count} PENDING notifications for template ${template.name}`);
            results.deletedNotifications += deleted.count;
          }
        }

        // Check for duplicates to prevent multiple sends (skip if reset mode)
        if (!reset) {
          const todayStartJST = startOfDay(nowJST);
          const todayStartUTC = fromZonedTime(todayStartJST, TIMEZONE);

          const alreadyProcessed = await prisma.notification.count({
            where: {
              targetDate: targetDate,
              notificationType: {
                contains: template.timingValue === 0 ? 'SAMEDAY' :
                          template.timingValue === 1 ? '1D' :
                          `${template.timingValue}D`
              },
              createdAt: {
                gte: todayStartUTC
              }
            }
          });

          if (alreadyProcessed > 0) {
            console.log(`  ✅ Already processed today for target date ${targetDateString}`);
            continue;
          }
        }

        console.log(`  🎯 Target date for classes: ${targetDateString}`);

        // Find teachers with classes
        const teachersWithClasses = await prisma.teacher.findMany({
          where: {
            lineNotificationsEnabled: true,
            lineId: { not: null },
            classSessions: {
              some: {
                date: targetDate,
                // Only include sessions with both teacher and student assigned
                studentId: { not: null }
              }
            }
          },
          select: {
            teacherId: true,
            name: true,
            lineId: true,
            classSessions: {
              where: { 
                date: targetDate,
                studentId: { not: null }
              },
              orderBy: { startTime: 'asc' },
              include: {
                student: { select: { studentId: true, name: true } },
                subject: { select: { name: true } },
                booth: { select: { name: true } },
                branch: { select: { branchId: true, name: true } }
              }
            }
          }
        });

        console.log(`  Found ${teachersWithClasses.length} teachers with classes`);

        // Find students with classes
        const studentsWithClasses = await prisma.student.findMany({
          where: {
            lineNotificationsEnabled: true,
            lineId: { not: null },
            classSessions: {
              some: {
                date: targetDate,
                // Only include sessions with both teacher and student assigned
                teacherId: { not: null }
              }
            }
          },
          select: {
            studentId: true,
            name: true,
            lineId: true,
            classSessions: {
              where: { 
                date: targetDate,
                teacherId: { not: null }
              },
              orderBy: { startTime: 'asc' },
              include: {
                teacher: { select: { teacherId: true, name: true } },
                subject: { select: { name: true } },
                booth: { select: { name: true } },
                branch: { select: { branchId: true, name: true } }
              }
            }
          }
        });

        console.log(`  Found ${studentsWithClasses.length} students with classes`);

        // Process recipients
        const recipientSessions = new Map<string, {
          recipientType: 'TEACHER' | 'STUDENT';
          recipientId: string;
          lineId: string;
          name: string;
          sessions: any[];
        }>();

        // Add teachers
        for (const teacher of teachersWithClasses) {
          if (teacher.lineId) {
            recipientSessions.set(`teacher-${teacher.teacherId}`, {
              recipientType: 'TEACHER',
              recipientId: teacher.teacherId,
              lineId: teacher.lineId,
              name: teacher.name,
              sessions: teacher.classSessions
            });
          }
        }

        // Add students
        for (const student of studentsWithClasses) {
          if (student.lineId) {
            recipientSessions.set(`student-${student.studentId}`, {
              recipientType: 'STUDENT',
              recipientId: student.studentId,
              lineId: student.lineId,
              name: student.name,
              sessions: student.classSessions
            });
          }
        }

        console.log(`  Total recipients: ${recipientSessions.size}`);

        // Create notifications for each recipient
        for (const [, recipient] of recipientSessions) {
          try {
            // Build class list
            const itemTemplate = template.classListItemTemplate || DEFAULT_CLASS_LIST_ITEM_TEMPLATE;
            const summaryTemplate = template.classListSummaryTemplate || DEFAULT_CLASS_LIST_SUMMARY_TEMPLATE;
            let dailyClassList = '';

            recipient.sessions.forEach((session, index) => {
              const startDate = new Date(session.startTime);
              const startTime = `${String(startDate.getUTCHours()).padStart(2, '0')}:${String(startDate.getUTCMinutes()).padStart(2, '0')}`;
              const endDate = new Date(session.endTime);
              const endTime = `${String(endDate.getUTCHours()).padStart(2, '0')}:${String(endDate.getUTCMinutes()).padStart(2, '0')}`;
              const durationMinutes = (endDate.getTime() - startDate.getTime()) / (1000 * 60);
              const duration = `${durationMinutes}分`;
              
              // Show appropriate names based on recipient type
              // Teachers see student names, students see teacher names
              const studentName = session.student?.name || '生徒未設定';
              const teacherName = session.teacher?.name || '講師未設定';
              
              // Log warning if data is missing
              if (!session.student?.name || !session.teacher?.name) {
                console.warn(`⚠️ Class session ${session.classId} is missing ${!session.student?.name ? 'student' : 'teacher'} information`);
              }

              // Modify the template based on recipient type to avoid showing redundant information
              let recipientSpecificTemplate = itemTemplate;
              if (recipient.recipientType === 'TEACHER') {
                // For teachers, remove their own name from the template
                recipientSpecificTemplate = itemTemplate.replace(/講師: {{teacherName}}\n?/g, '');
              } else if (recipient.recipientType === 'STUDENT') {
                // For students, remove their own name from the template
                recipientSpecificTemplate = itemTemplate.replace(/生徒: {{studentName}}\n?/g, '');
              }

              const classItemVariables = {
                classNumber: String(index + 1),
                subjectName: session.subject?.name || '科目未設定',
                startTime,
                endTime,
                teacherName,
                boothName: session.booth?.name || 'ブース未設定',
                duration,
                studentName
              };

              dailyClassList += replaceTemplateVariables(recipientSpecificTemplate, classItemVariables) + (index < recipient.sessions.length - 1 ? '\n\n' : '');
            });

            // Add summary if template exists
            if (summaryTemplate && recipient.sessions.length > 0) {
              const firstSession = recipient.sessions[0];
              const lastSession = recipient.sessions[recipient.sessions.length - 1];
              const firstStartDate = new Date(firstSession.startTime);
              const lastEndDate = new Date(lastSession.endTime);
              const summaryVariables = {
                classCount: String(recipient.sessions.length),
                firstClassTime: `${String(firstStartDate.getUTCHours()).padStart(2, '0')}:${String(firstStartDate.getUTCMinutes()).padStart(2, '0')}`,
                lastClassTime: `${String(lastEndDate.getUTCHours()).padStart(2, '0')}:${String(lastEndDate.getUTCMinutes()).padStart(2, '0')}`
              };
              dailyClassList += '\n\n' + replaceTemplateVariables(summaryTemplate, summaryVariables);
            }

            // Calculate summary variables
            const sortedSessions = [...recipient.sessions].sort((a, b) =>
              new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
            );

            const firstSession = sortedSessions[0];
            const lastSession = sortedSessions[sortedSessions.length - 1];
            const firstStartDate = new Date(firstSession.startTime);
            const lastEndDate = new Date(lastSession.endTime);
            const firstClassTime = `${String(firstStartDate.getUTCHours()).padStart(2, '0')}:${String(firstStartDate.getUTCMinutes()).padStart(2, '0')}`;
            const lastClassTime = `${String(lastEndDate.getUTCHours()).padStart(2, '0')}:${String(lastEndDate.getUTCMinutes()).padStart(2, '0')}`;

            const totalMinutes = sortedSessions.reduce((total, session) => {
              const duration = (new Date(session.endTime).getTime() - new Date(session.startTime).getTime()) / (1000 * 60);
              return total + duration;
            }, 0);

            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;
            const totalDuration = hours > 0 ? `${hours}時間${minutes > 0 ? minutes + '分' : ''}` : `${minutes}分`;
            const branchName = sortedSessions[0].branch?.name || template.branch?.name || '';
            
            // Determine branchId from sessions
            // If all sessions are from the same branch, use that branchId
            // Otherwise, use the first session's branchId
            const branchIds = [...new Set(sortedSessions.map(s => s.branch?.branchId).filter(Boolean))];
            const branchId = branchIds.length === 1 ? branchIds[0] : sortedSessions[0].branch?.branchId;
            
            if (!branchId) {
              console.warn(`    ⚠️ No branchId found for ${recipient.recipientType} ${recipient.name}. Sessions may not have branch information.`);
            }

            const templateVariables = {
              dailyClassList,
              recipientName: recipient.name,
              recipientType: recipient.recipientType === 'TEACHER' ? '講師' : '生徒',
              classDate: formatInTimeZone(targetDate, TIMEZONE, 'yyyy年M月d日'),
              currentDate: formatInTimeZone(nowJST, TIMEZONE, 'yyyy年M月d日'),
              classCount: String(recipient.sessions.length),
              firstClassTime,
              lastClassTime,
              totalDuration,
              branchName
            };

            const messageContent = replaceTemplateVariables(template.content, templateVariables);

            // Create notification with immediate scheduling
            const notificationType = template.timingValue === 0 ? 'DAILY_SUMMARY_SAMEDAY' :
                                   template.timingValue === 1 ? 'DAILY_SUMMARY_1D' :
                                   `DAILY_SUMMARY_${template.timingValue}D`;

            await createNotification({
              recipientType: recipient.recipientType,
              recipientId: recipient.recipientId,
              notificationType: notificationType,
              message: messageContent,
              targetDate: targetDate,
              templateId: template.id,
              branchId: branchId,
              scheduledAt: now,
              skipDuplicateCheck: reset // Skip duplicate check in reset mode
            });

            results.notificationsCreated++;
            console.log(`    ✅ Created notification for ${recipient.recipientType} ${recipient.name}`);
          } catch (error) {
            console.error(`    ❌ Failed to create notification for ${recipient.name}:`, error);
            results.errors.push(`Failed to create notification for ${recipient.name}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

      } catch (error) {
        console.error(`❌ Error processing template ${template.name}:`, error);
        results.errors.push(`Template ${template.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // PHASE 2: Send notifications
    console.log('\n📧 PHASE 2: Sending notifications...');
    results.phase = 'sending';

    // Wait a moment to ensure database writes are completed
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Run the notification worker to send pending notifications
    const workerResult = await runNotificationWorker({
      batchSize: 20,
      maxConcurrency: 5,
      maxExecutionTimeMs: 120000 // 2 minutes
    });

    results.notificationsSent = workerResult.successful;
    results.notificationsFailed = workerResult.failed;

    console.log(`✅ Worker completed: Sent ${workerResult.successful}, Failed ${workerResult.failed}`);

    // Calculate execution time
    results.executionTimeMs = Date.now() - startTime;
    results.phase = 'completed';

    console.log('\n📊 === UNIFIED NOTIFICATION PROCESSING COMPLETED ===');
    console.log(`Total notifications created: ${results.notificationsCreated}`);
    console.log(`Total notifications sent: ${results.notificationsSent}`);
    console.log(`Total notifications failed: ${results.notificationsFailed}`);
    console.log(`Total notifications deleted (reset): ${results.deletedNotifications}`);
    console.log(`Errors: ${results.errors.length}`);
    console.log(`Execution time: ${results.executionTimeMs}ms`);

    return results;

  } catch (error) {
    console.error('💥 Critical error in notification processing:', error);
    results.phase = 'error';
    results.errors.push(`Critical error: ${error instanceof Error ? error.message : String(error)}`);
    results.executionTimeMs = Date.now() - startTime;
    return results;
  }
}

/**
 * Unified notification cron job that creates and sends notifications in one flow.
 * This mirrors the manual "通知フロー全体を実行" button behavior.
 */
export async function GET(request: NextRequest) {
  console.log('📬 Unified notification cron triggered at:', new Date().toISOString());

  // Verify authentication
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // In development, allow without auth. In production, require CRON_SECRET
  if (process.env.NODE_ENV === 'production' && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    console.error('❌ Cron authentication failed');
    console.error('Expected:', cronSecret ? 'Bearer [HIDDEN]' : 'No secret set');
    console.error('Received:', authHeader || 'No auth header');
    return NextResponse.json({
      error: 'Unauthorized',
      hint: 'Make sure CRON_SECRET is set in Vercel environment variables and matches the cron job configuration'
    }, { status: 401 });
  }

  console.log('✅ Cron authentication passed');

  try {
    const results = await processNotifications();
    return NextResponse.json({ success: true, ...results });
  } catch (error) {
    console.error('Error in notification service:', error);
    return NextResponse.json({ 
      error: 'Internal server error', 
      details: error instanceof Error ? error.message : String(error) 
    }, { status: 500 });
  }
}

export const POST = withRole(
  ['ADMIN'],
  async (req: NextRequest) => {
    try {
      const body = await req.json();
      const reset = body.reset ?? false;
      const templateId = body.templateId;
      
      console.log('Manual notification trigger requested by admin');
      console.log('Reset mode:', reset);
      console.log('Template ID:', templateId || 'All templates');
      
      const results = await processNotifications(reset, templateId);
      return NextResponse.json({ success: true, manual: true, ...results });
    } catch (error) {
      console.error('Error in manual notification trigger:', error);
      return NextResponse.json({ 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : String(error) 
      }, { status: 500 });
    }
  }
);