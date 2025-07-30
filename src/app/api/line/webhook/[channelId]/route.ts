import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { decrypt } from '@/lib/encryption';
import {
  verifySignature,
  sendLineReply,
  LineWebhookBody,
  LineChannelCredentials
} from '@/lib/line-multi-channel';

export async function POST(req: NextRequest) {
  try {
    const channelId = req.url.split('/').pop();
    
    if (!channelId) {
      console.error('Missing channelId in webhook URL');
      return NextResponse.json({ error: 'Missing channel ID' }, { status: 400 });
    }
    
    const body = await req.text();
    const signature = req.headers.get('x-line-signature');

    console.log('LINE webhook received for channel:', channelId, {
      hasBody: !!body,
      bodyLength: body?.length,
      hasSignature: !!signature,
      signatureLength: signature?.length
    });

    // Check if signature is present
    if (!signature) {
      console.error('Missing x-line-signature header');
      return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
    }

    // Get channel credentials
    const channel = await prisma.lineChannel.findUnique({
      where: { channelId }
    });

    if (!channel || !channel.isActive) {
      console.error('Channel not found or inactive:', channelId);
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
    }

    const credentials: LineChannelCredentials = {
      channelAccessToken: decrypt(channel.channelAccessToken),
      channelSecret: decrypt(channel.channelSecret)
    };

    // Verify webhook signature
    if (!verifySignature(body, signature, credentials.channelSecret)) {
      console.error('Invalid LINE webhook signature for channel:', channelId);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    // Handle empty body (verification request)
    if (!body || body.trim() === '') {
      console.log('LINE webhook verification request received (empty body)');
      return NextResponse.json({}, { status: 200 });
    }

    // Parse the JSON body
    let data: LineWebhookBody;
    try {
      data = JSON.parse(body);
    } catch (parseError) {
      console.error('Error parsing LINE webhook body:', parseError);
      // For verification, LINE might send non-JSON data, so return 200 OK
      console.log('Returning 200 for non-JSON body (possible verification)');
      return NextResponse.json({}, { status: 200 });
    }

    // Handle verification or test requests with no events
    if (!data.events || data.events.length === 0) {
      console.log('LINE webhook received with no events (verification or test)');
      return NextResponse.json({}, { status: 200 });
    }

    // Get branches associated with this channel
    const channelBranches = await prisma.branchLineChannel.findMany({
      where: { channelId },
      select: { branchId: true }
    });
    const branchIds = channelBranches.map(cb => cb.branchId);

    console.log(`Processing ${data.events.length} LINE webhook events for channel ${channelId}`);

    // Process each event
    for (const event of data.events) {
      // Only process text messages
      if (event.type !== 'message' || event.message?.type !== 'text') {
        continue;
      }

      const text = event.message.text;
      const lineId = event.source.userId;
      const replyToken = event.replyToken;

      if (!text || !lineId || !replyToken) {
        continue;
      }

      // Check if message starts with "> " or "/ " (case-insensitive)
      const trimmedText = text.trim();
      const lowerText = trimmedText.toLowerCase();
      if (!lowerText.startsWith('> ') && !lowerText.startsWith('/ ')) {
        // Ignore regular chat messages - no error response
        console.log(`Ignoring regular chat message: ${trimmedText.substring(0, 50)}...`);
        continue;
      }

      // Remove the prefix and get the actual identifier (using regex for case-insensitive matching)
      const identifier = trimmedText.replace(/^(> |\/\s+)/i, '').trim();

      // Check for logout commands (exit, quit) - case insensitive
      const logoutRegex = /^(>?\s*exit|>?\s*quit|\/?\s*exit|\/?\s*quit)$/i;
      if (logoutRegex.test(trimmedText)) {
        // Find the user by LINE ID
        const student = await prisma.student.findFirst({
          where: { lineId },
          include: { user: true }
        });

        const teacher = await prisma.teacher.findFirst({
          where: { lineId },
          include: { user: true }
        });

        if (student) {
          // Clear LINE ID for student
          await prisma.student.update({
            where: { studentId: student.studentId },
            data: { 
              lineId: null,
              lineNotificationsEnabled: false
            }
          });

          try {
            await sendLineReply(
              replyToken,
              `✅ ログアウトしました。\n\n今後LINEで通知を受け取ることはありません。\n\n再度連携する場合は "> ${student.user.username}" または新しいアカウント名を送信してください。`,
              credentials
            );
          } catch (replyError) {
            console.error('Error sending logout reply for student:', replyError);
          }
          continue;
        } else if (teacher) {
          // Clear LINE ID for teacher
          await prisma.teacher.update({
            where: { teacherId: teacher.teacherId },
            data: { 
              lineId: null,
              lineNotificationsEnabled: false
            }
          });

          try {
            await sendLineReply(
              replyToken,
              `✅ ログアウトしました。\n\n今後LINEで通知を受け取ることはありません。\n\n再度連携する場合は "> ${teacher.user.username}" または新しいアカウント名を送信してください。`,
              credentials
            );
          } catch (replyError) {
            console.error('Error sending logout reply for teacher:', replyError);
          }
          continue;
        } else {
          // No linked account found
          try {
            await sendLineReply(
              replyToken,
              '❌ まだアカウントが連携されていません。\n\nアカウントを連携するには "> ユーザー名" を送信してください。',
              credentials
            );
          } catch (replyError) {
            console.error('Error sending no account reply:', replyError);
          }
          continue;
        }
      }

      // First try to find a user with this username
      let user = await prisma.user.findFirst({
        where: { 
          username: identifier,
          // If channel is associated with specific branches, limit to users in those branches
          ...(branchIds.length > 0 ? {
            branches: {
              some: {
                branchId: { in: branchIds }
              }
            }
          } : {})
        },
        include: {
          student: true,
          teacher: true,
          branches: true
        }
      });

      // If not found by username, try to find by LINE User ID
      if (!user) {
        const student = await prisma.student.findFirst({
          where: { 
            lineUserId: identifier,
            user: branchIds.length > 0 ? {
              branches: {
                some: {
                  branchId: { in: branchIds }
                }
              }
            } : undefined
          },
          include: {
            user: {
              include: {
                student: true,
                teacher: true,
                branches: true
              }
            }
          }
        });

        if (student) {
          user = student.user;
        } else {
          const teacher = await prisma.teacher.findFirst({
            where: { 
              lineUserId: identifier,
              user: branchIds.length > 0 ? {
                branches: {
                  some: {
                    branchId: { in: branchIds }
                  }
                }
              } : undefined
            },
            include: {
              user: {
                include: {
                  student: true,
                  teacher: true,
                  branches: true
                }
              }
            }
          });

          if (teacher) {
            user = teacher.user;
          }
        }
      }

      if (user) {
        // Check if user has a student or teacher profile
        if (user.student) {
          // Check if this LINE ID is already linked to another student account
          const existingStudent = await prisma.student.findFirst({
            where: {
              lineId,
              NOT: { studentId: user.student.studentId }
            }
          });

          if (existingStudent) {
            try {
              await sendLineReply(
                replyToken,
                'このLINEアカウントは既に別のアカウントにリンクされています。',
                credentials
              );
            } catch (replyError) {
              console.error('Error sending reply:', replyError);
            }
            continue;
          }

          // Link the LINE account to student
          await prisma.student.update({
            where: { studentId: user.student.studentId },
            data: {
              lineId,
              linkingCode: null // Clear any existing linking code
            }
          });

          // Get branch names for the message
          const userBranches = await prisma.userBranch.findMany({
            where: { userId: user.id },
            include: { branch: true }
          });
          const branchNames = userBranches.map(ub => ub.branch.name).join(', ');

          try {
            await sendLineReply(
              replyToken,
              `✅ LINEアカウントが正常にリンクされました！\n生徒名: ${user.student.name}\nユーザー名: ${user.username}\n所属: ${branchNames || 'なし'}\n\n授業の通知をこちらのLINEアカウントにお送りします。`,
              credentials
            );
          } catch (replyError) {
            console.error('Error sending success reply for student:', replyError);
          }
          continue;
        } else if (user.teacher) {
          // Check if this LINE ID is already linked to another teacher account
          const existingTeacher = await prisma.teacher.findFirst({
            where: {
              lineId,
              NOT: { teacherId: user.teacher.teacherId }
            }
          });

          if (existingTeacher) {
            try {
              await sendLineReply(
                replyToken,
                'このLINEアカウントは既に別のアカウントにリンクされています。',
                credentials
              );
            } catch (replyError) {
              console.error('Error sending reply:', replyError);
            }
            continue;
          }

          // Link the LINE account to teacher
          await prisma.teacher.update({
            where: { teacherId: user.teacher.teacherId },
            data: {
              lineId,
              linkingCode: null // Clear any existing linking code
            }
          });

          // Get branch names for the message
          const userBranches = await prisma.userBranch.findMany({
            where: { userId: user.id },
            include: { branch: true }
          });
          const branchNames = userBranches.map(ub => ub.branch.name).join(', ');

          try {
            await sendLineReply(
              replyToken,
              `✅ LINEアカウントが正常にリンクされました！\n講師名: ${user.teacher.name}\nユーザー名: ${user.username}\n所属: ${branchNames || 'なし'}\n\n授業の通知をこちらのLINEアカウントにお送りします。`,
              credentials
            );
          } catch (replyError) {
            console.error('Error sending success reply for teacher:', replyError);
          }
          continue;
        }
      }

      // Invalid username/LINE User ID or user has no student/teacher profile
      try {
        await sendLineReply(
          replyToken,
          '❌ 無効なユーザー名またはLINEユーザーIDです。\n\n正しいユーザー名またはLINEユーザーIDを入力するか、システム管理者にお問い合わせください。\n\n💡 ヒント: コマンドは "> " または "/ " で始めてください。',
          credentials
        );
      } catch (replyError) {
        console.error('Error sending invalid username reply:', replyError);
      }
    }

    return NextResponse.json({ status: 'ok' }, { status: 200 });
  } catch (error) {
    console.error('Error processing LINE webhook:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const channelId = req.url.split('/').pop();
    
    if (!channelId) {
      return NextResponse.json({ error: 'Missing channel ID' }, { status: 400 });
    }
    
    // Get channel information
    const channel = await prisma.lineChannel.findUnique({
      where: { channelId },
      include: {
        branchLineChannels: {
          include: {
            branch: true
          }
        }
      }
    });

    if (!channel) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
    }

    // Get branches assigned to this channel
    const branches = channel.branchLineChannels.map(bc => bc.branch.name);
    
    // Return webhook information
    return NextResponse.json({
      status: 'ok',
      webhook: {
        url: req.url,
        channelId: channel.channelId,
        channelName: channel.name,
        isActive: channel.isActive,
        branches: branches.length > 0 ? branches : ['No branches assigned'],
        setupInstructions: {
          step1: 'Copy this webhook URL',
          step2: 'Go to LINE Developers Console (https://developers.line.biz/console/)',
          step3: 'Select your channel',
          step4: 'Go to "Messaging API" tab',
          step5: 'In "Webhook settings", paste this URL and enable "Use webhook"',
          step6: 'Click "Verify" to test the connection',
          note: 'Make sure your NEXTAUTH_URL environment variable is set to your actual domain'
        }
      }
    });
  } catch (error) {
    console.error('Error handling webhook GET request:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}